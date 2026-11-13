import { appendSession, replaySession, sessionElapsed, type SessionAction } from '../recommender/session';
import type { CachedCatalog, CachedPractice, HistoryCoverage, Preferences, PracticeSnapshot, ProfileSnapshot, RequestOptions } from '../types/app';
import type { CFProblem, CFRatingChange, CFSubmission, CFUser, RecommendedProblem, CFContest } from '../types/codeforces';
import { codeforcesApi, getProblemUrl, normalizeHandle } from './codeforcesApi';
import { storageService } from './storage';
import { calculateHabitProgress } from './habitTracker';
import { enrichCatalog } from '../recommender/catalog';
import { selectRecommendationsV2, POLICY_VERSION } from '../recommender';
import { buildPracticeState, problemKey } from '../recommender/state';
import { appendEvent, emptyLedger, latestEvents, validateFeedback } from '../recommender/events';
import { summarizeRecommendationFeedback } from '../recommender/evaluation';
import type { PracticeFeedback, PracticeLedger, PracticePlan } from '../recommender/types';
import { format } from 'date-fns';

export const HISTORY_PAGE_SIZE = 1000;
const PROFILE_TTL = 5 * 60 * 1000;
const PRACTICE_TTL = 60 * 1000;
const CATALOG_TTL = 24 * 60 * 60 * 1000;
export const FULL_RECHECK_INTERVAL = 7 * 24 * 60 * 60 * 1000;
const PREF_KEY = 'preferences';

export const DEFAULT_PREFERENCES: Preferences = {
  personalHandle: null,
  dailyTarget: 2,
  practiceMinutes: 60,
  predictionParams: { dailyProblems: 2, difficultyOffset: 150, horizonMonths: 6 },
  chartView: 'enhanced',
};

interface CachedProfile {
  user: CFUser;
  ratings: CFRatingChange[];
  userUpdatedAt: number;
  ratingsUpdatedAt: number;
}

interface BrokerOptions {
  api?: typeof codeforcesApi;
  storage?: Pick<typeof storageService, 'getValue' | 'setValue'>;
  now?: () => number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Codeforces data is unavailable. Please retry.';
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function sanitizePreferences(raw: Partial<Preferences>): Preferences {
  const params = raw.predictionParams;
  return {
    personalHandle: raw.personalHandle ? normalizeHandle(raw.personalHandle) : null,
    dailyTarget: boundedNumber(raw.dailyTarget, 2, 1, 20),
    practiceMinutes: boundedNumber(raw.practiceMinutes, 60, 20, 240),
    practiceMode: raw.practiceMode === 'timed' || raw.practiceMode === 'guided' || raw.practiceMode === 'transfer' ? raw.practiceMode : 'adaptive',
    predictionParams: {
      dailyProblems: boundedNumber(params?.dailyProblems, 2, 1, 20),
      difficultyOffset: boundedNumber(params?.difficultyOffset, 150, -500, 1000),
      horizonMonths: boundedNumber(params?.horizonMonths, 6, 1, 24),
    },
    chartView: raw.chartView === 'original' ? 'original' : 'enhanced',
  };
}

function mergeSubmissions(previous: CFSubmission[], incoming: CFSubmission[]): CFSubmission[] {
  const byId = new Map(previous.map(submission => [submission.id, submission]));
  for (const submission of incoming) byId.set(submission.id, submission);
  return [...byId.values()].sort((a, b) => b.creationTimeSeconds - a.creationTimeSeconds || b.id - a.id);
}

export function historyCoverage(cache: CachedPractice): HistoryCoverage {
  return {
    complete: cache.complete,
    lastFullSyncAt: cache.lastFullSyncAt,
    loaded: cache.submissions.length,
    earliestTime: cache.submissions.length ? cache.submissions.reduce((oldest, submission) => Math.min(oldest, submission.creationTimeSeconds), Infinity) : undefined,
  };
}

/** Compatibility entry point; safety checks use the production selector. */
export function selectRecommendations(problems: CFProblem[], rating: number, solved: Set<string>, _seed: string): RecommendedProblem[] {
  const state = buildPracticeState([], [], rating, true, [], Date.now());
  state.solved = solved;
  return selectRecommendationsV2(enrichCatalog(problems, []), state, 2);
}

export function createDataBroker(options: BrokerOptions = {}) {
  const api = options.api ?? codeforcesApi;
  const storage = options.storage ?? storageService;
  const now = options.now ?? Date.now;
  const locks = new Map<string, Promise<unknown>>();
  const profilesInFlight = new Map<string, Promise<ProfileSnapshot>>();
  let catalogInFlight: Promise<CachedCatalog> | undefined;

  function locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    const next = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
    locks.set(key, next);
    void next.finally(() => { if (locks.get(key) === next) locks.delete(key); }).catch(() => {});
    return next;
  }

  async function getPreferences(): Promise<Preferences> {
    const saved = await storage.getValue<Preferences>(PREF_KEY);
    // Do not adopt legacy cf_handle: older versions overwrote it when viewing others.
    return sanitizePreferences(saved ?? DEFAULT_PREFERENCES);
  }

  async function updatePreferences(changes: Partial<Preferences>): Promise<Preferences> {
    return locked(PREF_KEY, async () => {
      const current = await getPreferences();
      const targetChanged = changes.dailyTarget !== undefined && changes.dailyTarget !== current.dailyTarget;
      const targetMinutes = targetChanged && changes.practiceMinutes === undefined
        ? Math.max(60, changes.dailyTarget! * 35)
        : changes.practiceMinutes;
      const next = sanitizePreferences({
        ...current,
        ...changes,
        ...(targetMinutes !== undefined ? { practiceMinutes: targetMinutes } : {}),
        predictionParams: { ...current.predictionParams, ...changes.predictionParams },
      });
      await storage.setValue(PREF_KEY, next);
      return next;
    });
  }

  async function detectViewer(handle: string): Promise<Preferences> {
    const viewer = normalizeHandle(handle);
    return locked(PREF_KEY, async () => {
      const preferences = await getPreferences();
      if (preferences.personalHandle) return preferences;
      const next = { ...preferences, personalHandle: viewer };
      await storage.setValue(PREF_KEY, next);
      return next;
    });
  }

  async function getProfile(handle: string, request: RequestOptions = {}): Promise<ProfileSnapshot> {
    handle = normalizeHandle(handle);
    const key = `cfchart:profile:${handle.toLowerCase()}`;
    const pending = profilesInFlight.get(key);
    if (pending) return pending;
    const operation = (async (): Promise<ProfileSnapshot> => {
      const cached = await storage.getValue<CachedProfile>(key);
      const timestamp = now();
      const refreshUser = request.force || !cached?.userUpdatedAt || timestamp - cached.userUpdatedAt >= PROFILE_TTL;
      const refreshRatings = request.force || !cached?.ratingsUpdatedAt || timestamp - cached.ratingsUpdatedAt >= PROFILE_TTL;
      const [userResult, ratingsResult] = await Promise.allSettled([
        refreshUser ? api.fetchUserInfo(handle) : Promise.resolve(cached!.user),
        refreshRatings ? api.fetchUserRatingHistory(handle) : Promise.resolve(cached!.ratings),
      ]);
      const errors: string[] = [];
      let user = cached?.user;
      let ratings = cached?.ratings ?? [];
      let userUpdatedAt = cached?.userUpdatedAt ?? 0;
      let ratingsUpdatedAt = cached?.ratingsUpdatedAt ?? 0;
      if (userResult.status === 'fulfilled') {
        user = userResult.value;
        if (refreshUser) userUpdatedAt = now();
      } else errors.push(`Profile: ${errorMessage(userResult.reason)}`);
      if (ratingsResult.status === 'fulfilled') {
        ratings = ratingsResult.value;
        if (refreshRatings) ratingsUpdatedAt = now();
      } else errors.push(`Rating history: ${errorMessage(ratingsResult.reason)}`);
      if (!user && ratingsResult.status === 'fulfilled') {
        const latest = [...ratings].sort((a, b) => b.ratingUpdateTimeSeconds - a.ratingUpdateTimeSeconds)[0];
        user = { handle, rating: latest?.newRating };
      }
      if (!user) throw (userResult.status === 'rejected' ? userResult.reason : new Error('Codeforces profile unavailable.'));
      const result: CachedProfile = { user, ratings, userUpdatedAt, ratingsUpdatedAt };
      if ((refreshUser && userResult.status === 'fulfilled') || (refreshRatings && ratingsResult.status === 'fulfilled')) {
        try {
          await storage.setValue(key, result);
        } catch (error) {
          errors.push(`Could not save this profile locally: ${errorMessage(error)}`);
        }
      }
      return {
        handle: user.handle, user, ratings,
        updatedAt: Math.min(userUpdatedAt || ratingsUpdatedAt, ratingsUpdatedAt || userUpdatedAt),
        stale: errors.length > 0,
        error: errors.length ? errors.join(' ') : undefined,
      };
    })();
    profilesInFlight.set(key, operation);
    void operation.finally(() => { if (profilesInFlight.get(key) === operation) profilesInFlight.delete(key); }).catch(() => {});
    return operation;
  }

  async function getCatalog(): Promise<CachedCatalog & { error?: string; contests?: CFContest[] }> {
    if (catalogInFlight) return catalogInFlight;
    const operation = (async () => {
      const cached = await storage.getValue<CachedCatalog>('cfchart:catalog');
      if (cached?.version === 2 && now() - cached.updatedAt < CATALOG_TTL) return cached;
      try {
        const [problems, contests] = await Promise.all([
          api.fetchProblemCatalog(),
          api.fetchContestList ? api.fetchContestList() : Promise.resolve([] as CFContest[])
        ]);
        const result: CachedCatalog = { version: 2, problems, contests, updatedAt: now() };
        await storage.setValue('cfchart:catalog', result);
        return result;
      } catch (error) {
        if (cached?.version === 2) return { ...cached, error: `Using the cached problem catalog: ${errorMessage(error)}` };
        throw error;
      }
    })();
    catalogInFlight = operation;
    void operation.finally(() => { if (catalogInFlight === operation) catalogInFlight = undefined; }).catch(() => {});
    return operation;
  }

  async function getPractice(handle: string, request: RequestOptions = {}): Promise<PracticeSnapshot> {
    handle = normalizeHandle(handle);
    const key = `cfchart:practice:${handle.toLowerCase()}`;
    return locked(key, async () => {
      let cached = await storage.getValue<CachedPractice>(key);
      const errors: string[] = [];
      const autoRecheck = Boolean(cached?.complete && cached.lastFullSyncAt && now() - cached.lastFullSyncAt >= FULL_RECHECK_INTERVAL);
      const shouldRefresh = request.force || request.syncMore || request.resetHistory || autoRecheck || !cached || now() - cached.updatedAt >= PRACTICE_TTL;
      if (shouldRefresh) {
        try {
          const latest = await api.fetchSubmissionPage(handle, 1, HISTORY_PAGE_SIZE);
          const previousIds = new Set(cached?.submissions.map(submission => submission.id));
          const overlap = latest.some(submission => previousIds.has(submission.id));
          const completePage = latest.length < HISTORY_PAGE_SIZE;
          const isReset = Boolean(request.resetHistory || autoRecheck);
          const complete = completePage || Boolean(!isReset && overlap && cached?.complete);
          cached = {
            handle,
            submissions: isReset || completePage || !overlap ? mergeSubmissions([], latest) : mergeSubmissions(cached!.submissions, latest),
            complete,
            lastFullSyncAt: completePage ? now() : isReset ? undefined : cached?.lastFullSyncAt,
            updatedAt: now(),
          };
          await storage.setValue(key, cached);
        } catch (error) {
          if (!cached) throw error;
          errors.push(errorMessage(error));
        }
      }
      if (!cached) throw new Error('Submission history unavailable.');
      // At most one older page per explicit action; never silently crawl an account.
      if (request.syncMore && !cached.complete && errors.length === 0) {
        try {
          const older = await api.fetchSubmissionPage(handle, cached.submissions.length + 1, HISTORY_PAGE_SIZE);
          const merged = mergeSubmissions(cached.submissions, older);
          cached = { ...cached, submissions: merged, complete: older.length < HISTORY_PAGE_SIZE,
            lastFullSyncAt: older.length < HISTORY_PAGE_SIZE ? now() : undefined };
          await storage.setValue(key, cached);
        } catch (error) {
          errors.push(errorMessage(error));
        }
      }
      const preferences = await getPreferences();
      const coverage = historyCoverage(cached);
      const ledger = await storage.getValue<PracticeLedger>(ledgerKey(handle)) ?? emptyLedger();
      let recommendations: RecommendedProblem[] = [];
      if (coverage.complete) {
        const [profile, catalog] = await Promise.allSettled([getProfile(handle), getCatalog()]);
        if (profile.status === 'rejected') errors.push(errorMessage(profile.reason));
        if (catalog.status === 'rejected') errors.push(`Recommendations: ${errorMessage(catalog.reason)}`);
        if (profile.status === 'fulfilled' && catalog.status === 'fulfilled') {
          if (profile.value.error) errors.push(profile.value.error);
          if (catalog.value.error) errors.push(catalog.value.error);
          const day = format(new Date(now()), 'yyyy-MM-dd');
          const saved = await storage.getValue<PracticePlan>(planKey(handle));

          // Automatic observation from public Codeforces API submissions without manual tracking
          let ledgerUpdated = false;
          const currentEvents = [...ledger.events];
          const savedItems = saved?.items ?? [];
          const okSubmissionsByKey = new Map<string, CFSubmission>();
          for (const s of cached.submissions) {
            if (s.verdict === 'OK' && s.problem?.contestId) {
              const k = problemKey(s.problem);
              if (!okSubmissionsByKey.has(k)) okSubmissionsByKey.set(k, s);
            }
          }
          for (const p of savedItems) {
            const key = problemKey(p);
            const okSub = okSubmissionsByKey.get(key);
            if (okSub) {
              const hasExisting = currentEvents.some(
                e => e.id === `cf-api:${key}:${okSub.id}`
              );
              if (!hasExisting) {
                currentEvents.push({
                  id: `cf-api:${key}:${okSub.id}`,
                  version: 1,
                  problemKey: key,
                  outcome: 'accepted',
                  timestamp: okSub.creationTimeSeconds * 1000,
                  problem: p,
                  provenance: 'codeforces-api',
                  assistance: 'unknown',
                  // minutes is undefined: thinking time is unknown and never inferred
                });
                ledgerUpdated = true;
              }
            }
          }
          // Also observe any outside problems solved today on Codeforces
          const catalogMap = new Map(catalog.value.problems.map(cp => [problemKey(cp), cp]));
          for (const s of cached.submissions) {
            if (s.verdict === 'OK' && s.problem?.contestId && format(new Date(s.creationTimeSeconds * 1000), 'yyyy-MM-dd') === day) {
              const key = problemKey(s.problem);
              const hasExisting = currentEvents.some(
                e => e.id === `cf-api:${key}:${s.id}`
              );
              if (!hasExisting) {
                const catProblem = catalogMap.get(key);
                const prob: RecommendedProblem = catProblem ? {
                  contestId: catProblem.contestId ?? s.problem.contestId ?? 0,
                  index: catProblem.index,
                  name: catProblem.name,
                  rating: catProblem.rating ?? 1400,
                  tags: catProblem.tags ?? [],
                  slot: 'core',
                  slotLabel: 'Practice',
                  pSolve: null,
                  plannedMinutes: 30,
                  reasons: ['Solved today on Codeforces'],
                  qualityScore: 1,
                  url: getProblemUrl(catProblem.contestId, catProblem.index),
                } : {
                  contestId: s.problem.contestId!,
                  index: s.problem.index,
                  name: s.problem.name,
                  rating: s.problem.rating ?? 1400,
                  tags: s.problem.tags ?? [],
                  slot: 'core',
                  slotLabel: 'Practice',
                  pSolve: null,
                  plannedMinutes: 30,
                  reasons: ['Solved today on Codeforces'],
                  qualityScore: 1,
                  url: getProblemUrl(s.problem.contestId!, s.problem.index),
                };
                currentEvents.push({
                  id: `cf-api:${key}:${s.id}`,
                  version: 1,
                  problemKey: key,
                  outcome: 'accepted',
                  timestamp: s.creationTimeSeconds * 1000,
                  problem: prob,
                  provenance: 'codeforces-api',
                  assistance: 'unknown',
                });
                ledgerUpdated = true;
              }
            }
          }
          if (ledgerUpdated) {
            ledger.events = currentEvents;
            await storage.setValue(ledgerKey(handle), ledger);
          }

          const state = buildPracticeState(cached.submissions, profile.value.ratings, profile.value.user.rating, true, ledger.events, now());
          state.mode = preferences.practiceMode;
          const previous = saved?.version === 1 && saved.policy === POLICY_VERSION && saved.day === day ? saved.items : [];
          const latest = latestEvents(ledger.events.filter(e => format(new Date(e.timestamp), 'yyyy-MM-dd') === day));
          const removed = new Set((ledger.removedSolves ?? []).filter(r => r.day === day).map(r => r.problemKey));
          const finished = previous.filter(p => {
            if (removed.has(problemKey(p))) return false;
            const event = latest.get(problemKey(p));
            return event ? !['skipped', 'already-solved'].includes(event.outcome) : p.slot !== 'revisit' && state.solved.has(problemKey(p));
          });
          const seenOutsideKeys = new Set<string>();
          const outsideProblems: RecommendedProblem[] = [];
          for (const e of latest.values()) {
            if (removed.has(e.problemKey)) continue;
            if (!['skipped', 'already-solved'].includes(e.outcome) && !previous.some(p => problemKey(p) === e.problemKey)) {
              if (!seenOutsideKeys.has(e.problemKey)) {
                seenOutsideKeys.add(e.problemKey);
                outsideProblems.push(e.problem);
              }
            }
          }
          const allFinished = [...finished, ...outsideProblems];
          const spent = allFinished.reduce((total, p) => total + Math.max(p.plannedMinutes, latest.get(problemKey(p))?.minutes ?? 0), 0)
            + [...latest.values()].filter(e => ['skipped', 'already-solved'].includes(e.outcome)).reduce((total, e) => total + (e.minutes ?? 0), 0);
          const pending = previous.filter(p => !allFinished.some(f => problemKey(f) === problemKey(p)) && !latest.has(problemKey(p)));
          const budget = preferences.practiceMinutes ?? 60;
          const remainingDailyTarget = Math.max(0, preferences.dailyTarget - allFinished.length);
          recommendations = selectRecommendationsV2(enrichCatalog(catalog.value.problems, catalog.value.contests ?? []), state,
            remainingDailyTarget, budget - spent, pending.filter(p => state.mode === 'adaptive' || !state.mode ? !['timed','guided','transfer'].includes(p.slot) : p.slot === state.mode));
          const plan: PracticePlan = { version: 1, policy: POLICY_VERSION, day, budget, target: preferences.dailyTarget,
            items: [...allFinished, ...recommendations] };
          if (JSON.stringify(saved) !== JSON.stringify(plan)) {
            // Log assignments, not inferred views/clicks. IDs make retries idempotent.
            const assignments = [...(ledger.assignments ?? [])];
            for (const problem of recommendations) {
              const id = `${POLICY_VERSION}:${day}:${problemKey(problem)}:${problem.slot}:${problem.plannedMinutes}`;
              if (!assignments.some(a => a.id === id)) assignments.push({ id, timestamp: now(), policy: POLICY_VERSION,
                problem, rating: state.recentRating, historyComplete: state.historyComplete, selectionProbability: 1 });
            }
            if (assignments.length !== (ledger.assignments?.length ?? 0)) await storage.setValue(ledgerKey(handle), { ...ledger, assignments });
            await storage.setValue(planKey(handle), plan);
          }
        }
      }
      return {
        handle, submissions: cached.submissions, updatedAt: cached.updatedAt, coverage,
        progress: calculateHabitProgress(cached.submissions, preferences.dailyTarget, new Date(now()), coverage, ledger.events, ledger.removedSolves),
        recommendations, error: errors.length ? [...new Set(errors)].join(' ') : undefined,
        stale: errors.length > 0 || now() - cached.updatedAt >= PRACTICE_TTL,
      };
    });
  }

  const ledgerKey = (handle: string) => `cfchart:learning:${handle.toLowerCase()}`;
  const planKey = (handle: string) => `cfchart:plan:${handle.toLowerCase()}`;
  async function recordPracticeFeedback(handle: string, feedback: PracticeFeedback): Promise<void> {
    handle = normalizeHandle(handle);
    validateFeedback(feedback);
    await locked(`cfchart:practice:${handle.toLowerCase()}`, async () => {
      const ledger = await storage.getValue<PracticeLedger>(ledgerKey(handle)) ?? emptyLedger();
      const duplicate = ledger.events.find(e => e.id === feedback.id);
      if (duplicate) { appendEvent(ledger, { ...duplicate, ...feedback, minutes: feedback.minutes ?? duplicate.minutes }); return; }
      const plan = await storage.getValue<PracticePlan>(planKey(handle));
      const day = format(new Date(now()), 'yyyy-MM-dd');
      let problem = plan?.day === day ? plan.items.find(p => problemKey(p) === feedback.problemKey) : undefined;
      if (!problem) {
        const cached = await storage.getValue<CachedPractice>(`cfchart:practice:${handle.toLowerCase()}`);
        const sub = cached?.submissions.find(s => problemKey(s.problem) === feedback.problemKey);
        const catalog = await storage.getValue<CachedCatalog>('cfchart:catalog');
        const catProblem = catalog?.problems.find(p => problemKey(p) === feedback.problemKey);
        const cfProblem = catProblem ?? sub?.problem;
        if (cfProblem) {
          problem = {
            contestId: cfProblem.contestId ?? 0,
            index: cfProblem.index,
            name: cfProblem.name,
            rating: cfProblem.rating ?? 1400,
            tags: cfProblem.tags ?? [],
            slot: 'core',
            slotLabel: 'Practice',
            pSolve: null,
            plannedMinutes: 30,
            reasons: [],
            qualityScore: 1,
            url: getProblemUrl(cfProblem.contestId, cfProblem.index),
          };
        }
      }
      if (!problem) throw new Error('Refresh your practice plan before recording this result.');
      // A new report is a new observation; never erase earlier attempts.
      const baseLedger = ledger;
      const latestTimer = replaySession(ledger.sessions ?? [], feedback.problemKey, now());
      // Completed sessions belong to previous attempts, not this untimed report.
      const timer = latestTimer && !latestTimer.stopped ? latestTimer : null;
      if (timer?.assistanceAtMs !== null && timer?.assistanceAtMs !== undefined && feedback.outcome === 'independent') throw new Error('Assistance was recorded. Choose an assisted outcome.');
      const elapsedMs = sessionElapsed(timer, now());
      const sessions = timer && !timer.stopped ? appendSession(ledger.sessions ?? [], { id: `${feedback.id}-stop`, at: now(), problemKey: feedback.problemKey, action: 'stop' }) : ledger.sessions;
      await storage.setValue(ledgerKey(handle), appendEvent({ ...baseLedger, sessions }, { ...feedback,
        ...(timer ? { timing: { source: 'explicit-timer' as const, elapsedMs, assistanceAtMs: timer.assistanceAtMs },
          minutes: feedback.minutes ?? elapsedMs / 60000 } : {}), version: 1, problem,
        timestamp: now(), provenance: 'self-report' }));
    });
  }
  async function practiceSession(handle: string, key: string, event?: { id: string; action: SessionAction }) {
    handle = normalizeHandle(handle);
    return locked(`cfchart:practice:${handle.toLowerCase()}`, async () => {
      const ledger = await storage.getValue<PracticeLedger>(ledgerKey(handle)) ?? emptyLedger();
      if (event) {
        if (!/^\d+-\w+$/.test(key)) throw new Error('Invalid problem key.');
        const sessions = appendSession(ledger.sessions ?? [], { ...event, at: now(), problemKey: key });
        if (sessions !== ledger.sessions) await storage.setValue(ledgerKey(handle), { ...ledger, sessions });
        return replaySession(sessions, key, now());
      }
      return replaySession(ledger.sessions ?? [], key, now());
    });
  }
  async function recordPracticeImpressions(handle: string, problemKeys: string[], day: string): Promise<void> {
    handle = normalizeHandle(handle);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(problemKeys) || problemKeys.length > 20 ||
      problemKeys.some(key => !/^\d+-\w+$/.test(key))) throw new Error('Invalid practice impressions.');
    await locked(`cfchart:practice:${handle.toLowerCase()}`, async () => {
      const plan = await storage.getValue<PracticePlan>(planKey(handle));
      if (!plan || plan.day !== day) return;
      const ledger = await storage.getValue<PracticeLedger>(ledgerKey(handle)) ?? emptyLedger();
      const impressions = [...(ledger.impressions ?? [])];
      const known = new Set(impressions.map(item => item.id));
      for (const key of problemKeys) {
        const position = plan.items.findIndex(item => problemKey(item) === key);
        if (position < 0) continue;
        const id = `${day}:${key}`;
        if (!known.has(id)) impressions.push({ id, day, problemKey: key, displayedAt: now(), position });
        known.add(id);
      }
      if (impressions.length !== (ledger.impressions?.length ?? 0)) {
        await storage.setValue(ledgerKey(handle), { ...ledger, impressions });
      }
    });
  }
  async function exportPracticeData(handle: string) {
    handle = normalizeHandle(handle);
    return locked(`cfchart:practice:${handle.toLowerCase()}`, async () => {
      const ledger = await storage.getValue<PracticeLedger>(ledgerKey(handle)) ?? emptyLedger();
      return { version: 1, handle, ledger, plan: await storage.getValue<PracticePlan>(planKey(handle)),
        recommendationFeedback: summarizeRecommendationFeedback(ledger) };
    });
  }
  async function removeTodaySolve(handle: string, key: string): Promise<void> {
    handle = normalizeHandle(handle);
    if (!/^\d+-\w+$/.test(key)) throw new Error('Invalid problem key.');
    await locked(`cfchart:practice:${handle.toLowerCase()}`, async () => {
      const ledger = await storage.getValue<PracticeLedger>(ledgerKey(handle)) ?? emptyLedger();
      const day = format(new Date(now()), 'yyyy-MM-dd');
      const removedSolves = ledger.removedSolves ?? [];
      if (!removedSolves.some(r => r.day === day && r.problemKey === key)) {
        await storage.setValue(ledgerKey(handle), { ...ledger, removedSolves: [...removedSolves, { day, problemKey: key }] });
      }
    });
  }
  async function clearPracticeData(handle: string): Promise<void> {
    handle = normalizeHandle(handle);
    await locked(`cfchart:practice:${handle.toLowerCase()}`, async () => {
      await storage.setValue(ledgerKey(handle), emptyLedger());
      await storage.setValue(planKey(handle), null);
    });
  }
  return { getPreferences, updatePreferences, detectViewer, getProfile, getPractice,
    recordPracticeFeedback, exportPracticeData, clearPracticeData, practiceSession, recordPracticeImpressions, removeTodaySolve };
}

export const dataBroker = createDataBroker();
