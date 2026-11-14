import { describe, expect, it, vi } from 'vitest';
import { createDataBroker, FULL_RECHECK_INTERVAL, HISTORY_PAGE_SIZE, selectRecommendations } from '../dataBroker';
import type { CFProblem, CFSubmission } from '../../types/codeforces';
import type { CachedPractice, Preferences } from '../../types/app';

function fixture() {
  const values = new Map<string, unknown>();
  const storage = {
    async getValue<T>(key: string) { return values.get(key) as T | undefined; },
    async setValue<T>(key: string, value: T) { values.set(key, structuredClone(value)); },
  };
  let clock = new Date(2026, 10, 10, 12).getTime();
  const api = {
    fetchUserInfo: vi.fn(async (handle: string) => ({ handle, rating: 1400 })),
    fetchUserRatingHistory: vi.fn(async () => [{ contestId: 1, contestName: 'Round 1', handle: 'alice', rank: 1, ratingUpdateTimeSeconds: 1000, oldRating: 0, newRating: 1400 }]),
    fetchSubmissionPage: vi.fn(async (_handle: string, _from?: number, _count?: number): Promise<CFSubmission[]> => []),
    fetchProblemCatalog: vi.fn(async (): Promise<CFProblem[]> => [{ contestId: 10, index: 'A', name: 'Warmup', rating: 1400, tags: [] }, { contestId: 10, index: 'B', name: 'Challenge', rating: 1600, tags: [] }]),
    fetchContestList: vi.fn(async () => []),
  };
  const broker = createDataBroker({ api, storage, now: () => clock });
  const submission = (id: number): CFSubmission => ({ id, creationTimeSeconds: Math.floor(clock / 1000) - (3000 - id), verdict: 'OK', problem: { contestId: id, index: 'A', name: `Task ${id}`, tags: [] } });
  return { broker, api, values, submission, advance: (ms: number) => { clock += ms; } };
}

describe('personal preferences', () => {
  it('never adopts a legacy viewed profile and preserves a selected handle during viewer detection', async () => {
    const { broker, values } = fixture();
    values.set('cf_handle', 'tourist');
    expect((await broker.getPreferences()).personalHandle).toBeNull();
    expect((await broker.detectViewer('alice')).personalHandle).toBe('alice');
    await broker.getProfile('tourist');
    expect((await broker.detectViewer('bob')).personalHandle).toBe('alice');
    expect((await broker.getPreferences()).personalHandle).toBe('alice');
  });

  it('serializes competing preference writes and saves the complete preferences', async () => {
    const { broker, values } = fixture();
    await Promise.all([broker.updatePreferences({ personalHandle: 'alice' }), broker.updatePreferences({ dailyTarget: 3 })]);
    const preferences = values.get('preferences') as Preferences;
    expect(preferences.personalHandle).toBe('alice');
    expect(preferences.dailyTarget).toBe(3);
    expect(preferences.predictionParams.horizonMonths).toBe(6);
  });
});

describe('last-good snapshots', () => {
  it('keeps real history on API failure and returns a visible error', async () => {
    const { broker, api, submission, advance, values } = fixture();
    api.fetchSubmissionPage.mockResolvedValue([submission(3000)]);
    const original = await broker.getPractice('alice');
    advance(120000);
    api.fetchSubmissionPage.mockRejectedValue(new Error('Offline'));
    const failed = await broker.getPractice('alice', { force: true });
    expect(failed.submissions).toEqual(original.submissions);
    expect(failed.progress.todayCount).toBe(1);
    expect(failed.updatedAt).toBe(original.updatedAt);
    expect(failed.error).toContain('Offline');
    expect(failed.stale).toBe(true);
    expect((values.get('cfchart:practice:alice') as CachedPractice).submissions).toHaveLength(1);
  });

  it('preserves ratings independently when only their refresh fails', async () => {
    const { broker, api, advance } = fixture();
    const initial = await broker.getProfile('alice');
    advance(400000);
    api.fetchUserInfo.mockResolvedValue({ handle: 'alice', rating: 1500 });
    api.fetchUserRatingHistory.mockRejectedValue(new Error('Rate limited'));
    const refreshed = await broker.getProfile('alice', { force: true });
    expect(refreshed.user.rating).toBe(1500);
    expect(refreshed.ratings).toEqual(initial.ratings);
    expect(refreshed.error).toContain('Rating history');
  });

  it('uses per-handle caches and avoids repeated requests while fresh', async () => {
    const { broker, api } = fixture();
    await Promise.all([broker.getProfile('alice'), broker.getProfile('ALICE')]);
    await broker.getProfile('alice');
    await broker.getProfile('bob');
    expect(api.fetchUserInfo).toHaveBeenCalledTimes(2);
  });

  it('uses the last-good catalog when its refresh fails without hiding the failure', async () => {
    const { broker, api, advance } = fixture();
    const initial = await broker.getPractice('alice');
    advance(25 * 60 * 60 * 1000);
    api.fetchProblemCatalog.mockRejectedValue(new Error('Offline'));
    api.fetchContestList.mockResolvedValue([]);
    const refreshed = await broker.getPractice('alice', { force: true });
    expect(refreshed.recommendations.map(problem => problem.url)).toEqual(initial.recommendations.map(problem => problem.url));
    expect(refreshed.error).toContain('cached problem catalog');
    expect(refreshed.stale).toBe(true);
  });
});

describe('resumable submission history', () => {
  it('bounds each action and withholds unsolved recommendations until complete', async () => {
    const { broker, api, submission, advance } = fixture();
    const firstPage = Array.from({ length: HISTORY_PAGE_SIZE }, (_, i) => submission(3000 - i));
    const olderPage = [submission(1999), submission(1998)];
    api.fetchSubmissionPage.mockImplementation(async (_handle, from) => from === 1 ? firstPage : olderPage);
    advance(2 * 86400000);
    const partial = await broker.getPractice('alice');
    expect(partial.coverage.complete).toBe(false);
    expect(partial.coverage.loaded).toBe(1000);
    expect(partial.recommendations).toEqual([]);
    expect(api.fetchSubmissionPage).toHaveBeenCalledTimes(1);
    expect(api.fetchProblemCatalog).not.toHaveBeenCalled();
    const complete = await broker.getPractice('alice', { syncMore: true });
    expect(api.fetchSubmissionPage).toHaveBeenCalledTimes(3);
    expect(api.fetchSubmissionPage).toHaveBeenLastCalledWith('alice', 1001, 1000);
    expect(complete.coverage.complete).toBe(true);
    expect(complete.coverage.loaded).toBe(1002);
    expect(complete.recommendations).toHaveLength(1);
  });

  it('abandons a misleading complete flag if a refreshed page has no overlap', async () => {
    const { broker, api, submission, values } = fixture();
    values.set('cfchart:practice:alice', { handle: 'alice', submissions: [submission(1)], complete: true, updatedAt: 1 });
    api.fetchSubmissionPage.mockResolvedValue(Array.from({ length: HISTORY_PAGE_SIZE }, (_, i) => submission(3000 - i)));
    const snapshot = await broker.getPractice('alice', { force: true });
    expect(snapshot.coverage.complete).toBe(false);
    expect(snapshot.submissions.some(item => item.id === 1)).toBe(false);
    expect(snapshot.recommendations).toEqual([]);
  });
});

describe('recommendation safety', () => {
  it('returns no solved fallback and never suggests tasks far below the selected difficulty', () => {
    const catalog = [{ contestId: 1, index: 'A', name: 'A', rating: 1400, tags: [] }];
    expect(selectRecommendations(catalog, 1400, new Set(['1-A']), 'day')).toEqual([]);
    expect(selectRecommendations(catalog, 3000, new Set(), 'day')).toEqual([]);
  });
});


describe('adaptive practice sessions', () => {
  it('preserves contest metadata and selection across fresh/cache paths', async () => {
    const { broker, api, values } = fixture();
    api.fetchContestList.mockResolvedValueOnce([{ id: 10, name: 'April Fools', type: 'CF', phase: 'FINISHED' }] as never);
    const first = await broker.getPractice('alice');
    const second = await broker.getPractice('alice');
    expect(first.recommendations).toEqual([]);
    expect(second.recommendations).toEqual(first.recommendations);
    expect(values.get('cfchart:catalog')).toMatchObject({ version: 2, contests: [{ id: 10 }] });
    expect(api.fetchContestList).toHaveBeenCalledTimes(1);
  });

  it('adapts the number of recommended problems when daily goal changes', async () => {
    const { broker, api } = fixture();
    api.fetchProblemCatalog.mockResolvedValue([
      { contestId: 10, index: 'A', name: 'Task 1', rating: 1400, tags: ['greedy'] },
      { contestId: 10, index: 'B', name: 'Task 2', rating: 1400, tags: ['math'] },
      { contestId: 10, index: 'C', name: 'Task 3', rating: 1400, tags: ['dp'] },
      { contestId: 10, index: 'D', name: 'Task 4', rating: 1400, tags: ['graphs'] },
      { contestId: 10, index: 'E', name: 'Task 5', rating: 1400, tags: ['trees'] },
    ]);

    await broker.updatePreferences({ dailyTarget: 2 });
    const initial = await broker.getPractice('alice');
    expect(initial.recommendations).toHaveLength(2);

    await broker.updatePreferences({ dailyTarget: 4 });
    const increased = await broker.getPractice('alice');
    expect(increased.recommendations).toHaveLength(4);
    expect(increased.recommendations[0].index).toBe(initial.recommendations[0].index);
    expect(increased.recommendations[1].index).toBe(initial.recommendations[1].index);

    await broker.updatePreferences({ dailyTarget: 1 });
    const decreased = await broker.getPractice('alice');
    expect(decreased.recommendations).toHaveLength(1);
    expect(decreased.recommendations[0].index).toBe(initial.recommendations[0].index);
  });

  it('pins assignments, saves idempotent feedback, and does not refill completed daily slots', async () => {
    const { broker } = fixture();
    await broker.updatePreferences({ dailyTarget: 1 });
    const first = await broker.getPractice('alice');
    expect(first.recommendations).toHaveLength(1);
    expect((await broker.getPractice('alice')).recommendations).toEqual(first.recommendations);
    const p = first.recommendations[0];
    const feedback = { id: 'result-1', problemKey: `${p.contestId}-${p.index}`, outcome: 'independent' as const, minutes: 25 };
    await broker.recordPracticeFeedback('alice', feedback);
    await broker.recordPracticeFeedback('alice', feedback);
    expect((await broker.exportPracticeData('alice')).ledger.events).toHaveLength(1);
    expect((await broker.exportPracticeData('alice')).ledger.assignments).toHaveLength(1);
    expect((await broker.getPractice('alice')).recommendations).toEqual([]);
    expect((await broker.exportPracticeData('bob')).ledger.events).toEqual([]);
    await expect(broker.recordPracticeFeedback('alice', { ...feedback, outcome: 'timeout' })).rejects.toThrow('already been used');
    await broker.clearPracticeData('alice');
    expect((await broker.exportPracticeData('alice')).ledger.events).toEqual([]);
  });

  it('automatically observes Codeforces API solves without manual tracking and allows optional feedback upgrades', async () => {
    const { broker, api } = fixture();
    await broker.updatePreferences({ dailyTarget: 1 });
    const first = await broker.getPractice('alice');
    expect(first.recommendations).toHaveLength(1);
    const p = first.recommendations[0];

    // User solves problem on Codeforces without manual feedback
    const okSub: CFSubmission = {
      id: 99999,
      creationTimeSeconds: 1762776000,
      verdict: 'OK',
      problem: { contestId: p.contestId, index: p.index, name: p.name, rating: p.rating, tags: [] },
    };
    api.fetchSubmissionPage.mockResolvedValue([okSub]);

    const refreshed = await broker.getPractice('alice', { force: true });
    // Problem is automatically marked as solved
    expect(refreshed.recommendations).toEqual([]);

    const data = await broker.exportPracticeData('alice');
    expect(data.ledger.events).toHaveLength(1);
    const autoEvent = data.ledger.events[0];
    expect(autoEvent.provenance).toBe('codeforces-api');
    expect(autoEvent.outcome).toBe('accepted');
    expect(autoEvent.assistance).toBe('unknown');
    expect(autoEvent.minutes).toBeUndefined(); // Thinking time is unknown and never inferred

    // User optionally provides explicit self-report later
    await broker.recordPracticeFeedback('alice', {
      id: 'optional-report-1',
      problemKey: `${p.contestId}-${p.index}`,
      outcome: 'independent',
      minutes: 20,
    });
    const updatedData = await broker.exportPracticeData('alice');
    expect(updatedData.ledger.events).toHaveLength(2);
    expect(updatedData.ledger.events[0]).toEqual(autoEvent);
    const upgradedEvent = updatedData.ledger.events[1];
    expect(upgradedEvent.provenance).toBe('self-report');
    expect(upgradedEvent.outcome).toBe('independent');
    expect(upgradedEvent.minutes).toBe(20);
  });

  it('counts problems solved outside the recommended list towards the daily goal', async () => {
    const { broker, api, advance } = fixture();
    api.fetchProblemCatalog.mockResolvedValue([
      { contestId: 10, index: 'A', name: 'Task 1', rating: 1400, tags: ['greedy'] },
      { contestId: 10, index: 'B', name: 'Task 2', rating: 1400, tags: ['math'] },
      { contestId: 10, index: 'C', name: 'Task 3', rating: 1400, tags: ['dp'] },
    ]);
    await broker.updatePreferences({ dailyTarget: 2 });
    const first = await broker.getPractice('alice');
    expect(first.recommendations).toHaveLength(2);
    expect(first.progress.todayCount).toBe(0);
    expect(first.progress.isTodayTargetMet).toBe(false);

    // Alice solves problem 50-A (outside the recommended list) today on Codeforces
    const todaySec = Math.floor(new Date(2026, 10, 10, 12).getTime() / 1000);
    const outsideSub: CFSubmission = {
      id: 88888,
      creationTimeSeconds: todaySec,
      verdict: 'OK',
      problem: { contestId: 50, index: 'A', name: 'Domino piling', rating: 800, tags: ['math'] },
    };
    api.fetchSubmissionPage.mockResolvedValue([outsideSub]);

    const refreshed = await broker.getPractice('alice', { force: true });
    expect(refreshed.progress.todayCount).toBe(1);
    expect(refreshed.progress.isTodayTargetMet).toBe(false);
    expect(refreshed.progress.todayProblems.some(p => p.key === '50-A')).toBe(true);
    // Adapts recommendations: only 1 problem remaining to meet daily goal
    expect(refreshed.recommendations).toHaveLength(1);

    // Alice solves a second problem outside the list
    const outsideSub2: CFSubmission = {
      id: 88889,
      creationTimeSeconds: todaySec + 60,
      verdict: 'OK',
      problem: { contestId: 50, index: 'B', name: 'Another problem', rating: 900, tags: [] },
    };
    api.fetchSubmissionPage.mockResolvedValue([outsideSub, outsideSub2]);

    advance(60000);
    const completed = await broker.getPractice('alice', { force: true });
    expect(completed.progress.todayCount).toBe(2);
    expect(completed.progress.isTodayTargetMet).toBe(true);
    // Daily goal met: 0 more recommendations needed
    expect(completed.recommendations).toHaveLength(0);
  });

  it('replaces skipped tasks and respects time already used', async () => {
    const { broker } = fixture();
    const first = await broker.getPractice('alice');
    const p = first.recommendations[0];
    await broker.recordPracticeFeedback('alice', { id: 'skip-1', problemKey: `${p.contestId}-${p.index}`, outcome: 'skipped', minutes: 30 });
    expect((await broker.getPractice('alice')).recommendations).toEqual([]); // Remaining stretch needs 40 minutes.
  });

  it('rejects unknown assignments and invalid feedback without modifying the ledger', async () => {
    const { broker } = fixture();
    await expect(broker.recordPracticeFeedback('alice', { id: 'x', problemKey: '99-A', outcome: 'independent' })).rejects.toThrow('Refresh');
    await expect(broker.recordPracticeFeedback('alice', { id: 'x', problemKey: '99-A', outcome: 'independent', minutes: -1 })).rejects.toThrow('Invalid');
    expect((await broker.exportPracticeData('alice')).ledger.events).toEqual([]);
  });
});


describe('history revalidation', () => {
  it('invalidates old solved coverage during an explicit full recheck', async () => {
    const { broker, api, values, submission } = fixture();
    values.set('cfchart:practice:alice', { handle: 'alice', submissions: [submission(1)], complete: true, updatedAt: 1 });
    api.fetchSubmissionPage.mockResolvedValue([submission(1), ...Array.from({ length: 999 }, (_, i) => submission(5000 + i))]);
    const result = await broker.getPractice('alice', { resetHistory: true });
    expect(result.coverage.complete).toBe(false);
    expect(result.recommendations).toEqual([]);
  });

  it('automatically rechecks solved history when the check interval elapses', async () => {
    const { broker, api, values, submission, advance } = fixture();
    const initialSyncTime = 1000;
    values.set('cfchart:practice:alice', {
      handle: 'alice',
      submissions: [submission(1)],
      complete: true,
      lastFullSyncAt: initialSyncTime,
      updatedAt: initialSyncTime,
    });
    api.fetchSubmissionPage.mockResolvedValue([submission(1)]);

    advance(FULL_RECHECK_INTERVAL + 1000);
    const result = await broker.getPractice('alice');
    expect(api.fetchSubmissionPage).toHaveBeenCalledWith('alice', 1, 1000);
    expect(result.coverage.complete).toBe(true);
    expect(result.coverage.lastFullSyncAt).toBeGreaterThan(initialSyncTime);
  });
});


describe('review regressions', () => {
  it('revalidates older pages before renewing full-history coverage', async () => {
    const { broker, api, values, submission } = fixture();
    const page = Array.from({ length: 1000 }, (_, i) => submission(3000 - i));
    values.set('cfchart:practice:alice', { handle: 'alice', submissions: [...page, submission(1)], complete: true, lastFullSyncAt: 1, updatedAt: 1 });
    api.fetchSubmissionPage.mockImplementation(async (_handle, from) => from === 1 ? page : [{ ...submission(1), verdict: 'WRONG_ANSWER' }]);
    const pending = await broker.getPractice('alice');
    expect(pending.coverage.complete).toBe(false);
    expect(pending.coverage.lastFullSyncAt).toBeUndefined();
    expect(pending.recommendations).toEqual([]);
    const refreshed = await broker.getPractice('alice', { syncMore: true });
    expect(refreshed.coverage.complete).toBe(true);
    expect(refreshed.submissions.find(s => s.id === 1)?.verdict).toBe('WRONG_ANSWER');
    expect(refreshed.coverage.lastFullSyncAt).toBeGreaterThan(1);
  });

  it('does not inherit assistance or timing from a completed attempt', async () => {
    const { broker, advance } = fixture();
    const p = (await broker.getPractice('alice')).recommendations[0];
    const key = `${p.contestId}-${p.index}`;
    await broker.practiceSession('alice', key, { id: 'start', action: 'start' });
    advance(60000);
    await broker.practiceSession('alice', key, { id: 'help', action: 'assistance' });
    await expect(broker.recordPracticeFeedback('alice', { id: 'invalid', problemKey: key, outcome: 'independent' })).rejects.toThrow('Assistance');
    await broker.recordPracticeFeedback('alice', { id: 'first', problemKey: key, outcome: 'assisted' });
    advance(4 * 86400000);
    await broker.recordPracticeFeedback('alice', { id: 'review', problemKey: key, outcome: 'independent' });
    const events = (await broker.exportPracticeData('alice')).ledger.events;
    expect(events).toHaveLength(2);
    expect(events[0].timing?.elapsedMs).toBe(60000);
    expect(events[1].timing).toBeUndefined();
    expect(events[1].minutes).toBeUndefined();
  });

  it('records only displayed problems from the current plan and exports a descriptive outcome join', async () => {
    const { broker } = fixture();
    await broker.updatePreferences({ personalHandle: 'alice' });
    const plan = await broker.getPractice('alice');
    const key = `${plan.recommendations[0].contestId}-${plan.recommendations[0].index}`;
    await broker.recordPracticeImpressions('alice', [key, '9999-Z'], '2026-11-10');
    await broker.recordPracticeImpressions('alice', [key], '2026-11-10');
    const data = await broker.exportPracticeData('alice') as { ledger: { impressions?: unknown[] }; recommendationFeedback: { impressions: number; exposedAssignments: number } };
    expect(data.ledger.impressions).toHaveLength(1);
    expect(data.recommendationFeedback).toMatchObject({ impressions: 1, exposedAssignments: 1 });
  });

  it('observes a later acceptance despite an earlier self-report and deduplicates refreshes', async () => {
    const { broker, api, advance, submission } = fixture();
    const p = (await broker.getPractice('alice')).recommendations[0];
    const key = `${p.contestId}-${p.index}`;
    await broker.recordPracticeFeedback('alice', { id: 'assisted', problemKey: key, outcome: 'assisted' });
    advance(4 * 86400000);
    api.fetchSubmissionPage.mockResolvedValue([{ ...submission(9000), problem: p }]);
    await broker.getPractice('alice', { force: true });
    await broker.getPractice('alice', { force: true });
    const events = (await broker.exportPracticeData('alice')).ledger.events;
    expect(events).toHaveLength(2);
    expect(events[0].outcome).toBe('assisted');
    expect(events[1]).toMatchObject({ outcome: 'accepted', assistance: 'unknown', provenance: 'codeforces-api' });
  });

  it('keeps scheduled reviews independent of dailyTarget and daily progress', async () => {
    const { broker, api, advance, submission } = fixture();
    await broker.updatePreferences({ personalHandle: 'alice', dailyTarget: 1 });
    const first = (await broker.getPractice('alice')).recommendations[0];
    const reviewKey = `${first.contestId}-${first.index}`;
    await broker.recordPracticeFeedback('alice', { id: 'assisted-1', problemKey: reviewKey, outcome: 'assisted' });

    advance(4 * 86400000);
    // Satisfy today's dailyTarget=1 with a new outside solve
    api.fetchSubmissionPage.mockResolvedValue([submission(2999)]);
    const snap = await broker.getPractice('alice', { force: true });
    expect(snap.progress.isTodayTargetMet).toBe(true);
    expect(snap.recommendations.map(r => `${r.contestId}-${r.index}`)).toEqual([reviewKey]);
    expect(snap.recommendations[0].slot).toBe('revisit');
  });

  it('does not count timeout outcomes as completing dailyTarget', async () => {
    const { broker } = fixture();
    await broker.updatePreferences({ personalHandle: 'alice', dailyTarget: 2, practiceMinutes: 90 });
    const first = (await broker.getPractice('alice')).recommendations[0];
    await broker.recordPracticeFeedback('alice', {
      id: 'timeout-1',
      problemKey: `${first.contestId}-${first.index}`,
      outcome: 'timeout',
      minutes: 20,
    });
    const after = await broker.getPractice('alice');
    expect(after.progress.todayCount).toBe(0);
    expect(after.recommendations.length).toBeGreaterThan(0);
  });
});

it('removes a solve locally across refreshes without hiding a later day or another account', async () => {
  const { broker, api, submission, advance } = fixture();
  api.fetchSubmissionPage.mockResolvedValue([submission(3000)]);
  expect((await broker.getPractice('alice')).progress.todayCount).toBe(1);
  await broker.removeTodaySolve('alice', '3000-A');
  await broker.removeTodaySolve('alice', '3000-A');
  const refreshed = await broker.getPractice('alice', { force: true });
  expect(refreshed.progress.todayCount).toBe(0);
  expect(refreshed.progress.todayProblems).toEqual([]);
  expect(refreshed.submissions).toHaveLength(1);
  expect((await broker.exportPracticeData('alice')).ledger.removedSolves).toHaveLength(1);
  expect((await broker.getPractice('bob')).progress.todayCount).toBe(1);
  advance(86400000);
  api.fetchSubmissionPage.mockResolvedValue([submission(3000)]);
  expect((await broker.getPractice('alice', { force: true })).progress.todayCount).toBe(1);
});
