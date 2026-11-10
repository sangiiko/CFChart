import type { CachedCatalog, CachedPractice, HistoryCoverage, Preferences, PracticeSnapshot, ProfileSnapshot, RequestOptions } from '../types/app';
import type { CFProblem, CFRatingChange, CFSubmission, CFUser, RecommendedProblem } from '../types/codeforces';
import { codeforcesApi, getProblemKey, getProblemUrl, normalizeHandle } from './codeforcesApi';
import { storageService } from './storage';
import { calculateHabitProgress } from './habitTracker';

export const HISTORY_PAGE_SIZE = 1000;
const PROFILE_TTL = 5 * 60 * 1000;
const PRACTICE_TTL = 60 * 1000;
const CATALOG_TTL = 24 * 60 * 60 * 1000;
const PREF_KEY = 'preferences';

export const DEFAULT_PREFERENCES: Preferences = {
  personalHandle: null,
  dailyTarget: 2,
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
    loaded: cache.submissions.length,
    earliestTime: cache.submissions.length ? cache.submissions.reduce((oldest, submission) => Math.min(oldest, submission.creationTimeSeconds), Infinity) : undefined,
  };
}

function stableHash(text: string): number {
  let hash = 0;
  for (const char of text) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return hash >>> 0;
}

/** Only call with a complete solved index; no solved or unrelated fallback tasks. */
export function selectRecommendations(problems: CFProblem[], rating: number, solved: Set<string>, seed: string): RecommendedProblem[] {
  const target = Math.max(800, Math.round(rating / 100) * 100);
  const selected = new Set<string>();
  const results: RecommendedProblem[] = [];
  for (const [offset, type] of [[0, 'warmup'], [200, 'challenge']] as const) {
    const eligible = problems.filter(problem => {
      const key = getProblemKey(problem.contestId, problem.index);
      return key && !solved.has(key) && !selected.has(key) && problem.rating !== undefined && Math.abs(problem.rating - (target + offset)) <= 200;
    });
    eligible.sort((a, b) => Math.abs(a.rating! - target - offset) - Math.abs(b.rating! - target - offset)
      || stableHash(`${seed}:${getProblemKey(a.contestId, a.index)}`) - stableHash(`${seed}:${getProblemKey(b.contestId, b.index)}`));
    const problem = eligible[0];
    if (problem?.contestId && problem.rating !== undefined) {
      selected.add(getProblemKey(problem.contestId, problem.index));
      results.push({ ...problem, contestId: problem.contestId, rating: problem.rating, type, url: getProblemUrl(problem.contestId, problem.index) });
    }
  }
  return results;
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
      const next = sanitizePreferences({ ...current, ...changes, predictionParams: { ...current.predictionParams, ...changes.predictionParams } });
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

  async function getCatalog(): Promise<CachedCatalog & { error?: string }> {
    if (catalogInFlight) return catalogInFlight;
    const operation = (async () => {
      const cached = await storage.getValue<CachedCatalog>('cfchart:catalog');
      if (cached && now() - cached.updatedAt < CATALOG_TTL) return cached;
      try {
        const problems = await api.fetchProblemCatalog();
        const result = { problems, updatedAt: now() };
        await storage.setValue('cfchart:catalog', result);
        return result;
      } catch (error) {
        if (cached) return { ...cached, error: `Using the cached problem catalog: ${errorMessage(error)}` };
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
      const shouldRefresh = request.force || request.syncMore || !cached || now() - cached.updatedAt >= PRACTICE_TTL;
      if (shouldRefresh) {
        try {
          const latest = await api.fetchSubmissionPage(handle, 1, HISTORY_PAGE_SIZE);
          const previousIds = new Set(cached?.submissions.map(submission => submission.id));
          const overlap = latest.some(submission => previousIds.has(submission.id));
          const completePage = latest.length < HISTORY_PAGE_SIZE;
          cached = {
            handle,
            submissions: completePage || !overlap ? mergeSubmissions([], latest) : mergeSubmissions(cached!.submissions, latest),
            complete: completePage || Boolean(overlap && cached?.complete),
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
          cached = { ...cached, submissions: merged, complete: older.length < HISTORY_PAGE_SIZE };
          await storage.setValue(key, cached);
        } catch (error) {
          errors.push(errorMessage(error));
        }
      }
      const preferences = await getPreferences();
      const coverage = historyCoverage(cached);
      let recommendations: RecommendedProblem[] = [];
      if (coverage.complete) {
        const [profile, catalog] = await Promise.allSettled([getProfile(handle), getCatalog()]);
        if (profile.status === 'rejected') errors.push(errorMessage(profile.reason));
        if (catalog.status === 'rejected') errors.push(`Recommendations: ${errorMessage(catalog.reason)}`);
        if (profile.status === 'fulfilled' && catalog.status === 'fulfilled') {
          if (profile.value.error) errors.push(profile.value.error);
          if (catalog.value.error) errors.push(catalog.value.error);
          const solved = new Set(cached.submissions.filter(submission => submission.verdict === 'OK').map(submission => getProblemKey(submission.problem.contestId, submission.problem.index)));
          const day = new Date(now()).toLocaleDateString('en-CA');
          recommendations = selectRecommendations(catalog.value.problems, profile.value.user.rating ?? 800, solved, `${handle.toLowerCase()}:${day}`);
        }
      }
      return {
        handle, submissions: cached.submissions, updatedAt: cached.updatedAt, coverage,
        progress: calculateHabitProgress(cached.submissions, preferences.dailyTarget, new Date(now()), coverage),
        recommendations, error: errors.length ? [...new Set(errors)].join(' ') : undefined,
        stale: errors.length > 0 || now() - cached.updatedAt >= PRACTICE_TTL,
      };
    });
  }

  return { getPreferences, updatePreferences, detectViewer, getProfile, getPractice };
}

export const dataBroker = createDataBroker();
