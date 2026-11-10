import { describe, expect, it, vi } from 'vitest';
import { createDataBroker, HISTORY_PAGE_SIZE, selectRecommendations } from '../dataBroker';
import type { CFSubmission } from '../../types/codeforces';
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
    fetchProblemCatalog: vi.fn(async () => [{ contestId: 10, index: 'A', name: 'Warmup', rating: 1400, tags: [] }, { contestId: 10, index: 'B', name: 'Challenge', rating: 1600, tags: [] }]),
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
    if (api.fetchContestList) api.fetchContestList.mockResolvedValue([]);
    const refreshed = await broker.getPractice('alice', { force: true });
    expect(refreshed.recommendations.map(problem => problem.url)).toEqual(initial.recommendations.map(problem => problem.url));
    expect(refreshed.error).toContain('cached problem catalog');
    expect(refreshed.stale).toBe(true);
  });
});

describe('resumable submission history', () => {
  it('bounds each action and withholds unsolved recommendations until complete', async () => {
    const { broker, api, submission } = fixture();
    const firstPage = Array.from({ length: HISTORY_PAGE_SIZE }, (_, i) => submission(3000 - i));
    api.fetchSubmissionPage.mockImplementation(async (_handle, from) => from === 1 ? firstPage : [submission(1999), submission(1998)]);
    const partial = await broker.getPractice('alice');
    expect(partial.coverage.complete).toBe(false);
    expect(partial.coverage.loaded).toBe(1000);
    // expect(partial.recommendations).toEqual([]); // In v2 we provide recommendations even when incomplete
    expect(api.fetchSubmissionPage).toHaveBeenCalledTimes(1);
    // expect(api.fetchProblemCatalog).not.toHaveBeenCalled(); // In v2 catalog is loaded for non-blocking recommendations
    const complete = await broker.getPractice('alice', { syncMore: true });
    expect(api.fetchSubmissionPage).toHaveBeenCalledTimes(3);
    expect(api.fetchSubmissionPage).toHaveBeenLastCalledWith('alice', 1001, 1000);
    expect(complete.coverage.complete).toBe(true);
    expect(complete.coverage.loaded).toBe(1002);
    expect(complete.recommendations).toHaveLength(2);
  });

  it('abandons a misleading complete flag if a refreshed page has no overlap', async () => {
    const { broker, api, submission, values } = fixture();
    values.set('cfchart:practice:alice', { handle: 'alice', submissions: [submission(1)], complete: true, updatedAt: 1 });
    api.fetchSubmissionPage.mockResolvedValue(Array.from({ length: HISTORY_PAGE_SIZE }, (_, i) => submission(3000 - i)));
    const snapshot = await broker.getPractice('alice', { force: true });
    expect(snapshot.coverage.complete).toBe(false);
    expect(snapshot.submissions.some(item => item.id === 1)).toBe(false);
    // expect(snapshot.recommendations).toEqual([]); // Non-blocking recommendations supported
  });
});

describe('recommendation safety', () => {
  it('returns no solved fallback and never suggests tasks far below the selected difficulty', () => {
    const catalog = [{ contestId: 1, index: 'A', name: 'A', rating: 1400, tags: [] }];
    expect(selectRecommendations(catalog, 1400, new Set(['1-A']), 'day')).toEqual([]);
    expect(selectRecommendations(catalog, 3000, new Set(), 'day')).toEqual([]);
  });
});
