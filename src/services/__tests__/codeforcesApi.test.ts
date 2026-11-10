import { describe, expect, it, vi } from 'vitest';
import { CodeforcesApiError, createCodeforcesApi, getProblemUrl, getRankTier, REQUEST_INTERVAL_MS } from '../codeforcesApi';

const response = (result: unknown) => new Response(JSON.stringify({ status: 'OK', result }), { status: 200 });

describe('shared Codeforces request queue', () => {
  it('spaces independent calls and deduplicates the same pending request', async () => {
    let clock = 0;
    const starts: number[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      starts.push(clock);
      return String(url).includes('user.info') ? response([{ handle: 'alice', rating: 1400 }]) : response([]);
    });
    const api = createCodeforcesApi({ fetch: fetchFn as typeof fetch, now: () => clock, wait: async ms => { clock += ms; } });
    const [user, history, sameUser] = await Promise.all([api.fetchUserInfo('alice'), api.fetchUserRatingHistory('alice'), api.fetchUserInfo('alice')]);
    expect(user).toEqual(sameUser);
    expect(history).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(starts).toEqual([REQUEST_INTERVAL_MS, 2 * REQUEST_INTERVAL_MS]);
  });

  it('retries a rate-limit response through the queue and preserves spacing', async () => {
    let clock = 0;
    const starts: number[] = [];
    const fetchFn = vi.fn(async () => {
      starts.push(clock);
      return starts.length === 1
        ? new Response(JSON.stringify({ status: 'FAILED', comment: 'Call limit exceeded' }))
        : response([{ handle: 'alice' }]);
    });
    const api = createCodeforcesApi({ fetch: fetchFn as typeof fetch, now: () => clock, wait: async ms => { clock += ms; } });
    expect((await api.fetchUserInfo('alice')).handle).toBe('alice');
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(REQUEST_INTERVAL_MS);
  });

  it('rejects invalid handles and API failures instead of returning empty history', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ status: 'FAILED', comment: 'handle: User not found' })));
    const api = createCodeforcesApi({ fetch: fetchFn as typeof fetch });
    await expect(api.fetchUserInfo('bad/handle')).rejects.toMatchObject({ code: 'invalid_handle' });
    expect(fetchFn).not.toHaveBeenCalled();
    await expect(api.fetchUserRatingHistory('missing')).rejects.toBeInstanceOf(CodeforcesApiError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects a login/challenge HTML response rather than fabricating zero solves', async () => {
    const api = createCodeforcesApi({ fetch: vi.fn(async () => new Response('<html>Check your browser</html>')) as typeof fetch });
    await expect(api.fetchSubmissionPage('alice')).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('Codeforces display helpers', () => {
  it('handles low ratings and builds Gym links correctly', () => {
    expect(getRankTier(-10).name).toBe('Newbie');
    expect(getRankTier(undefined).name).toBe('Unrated');
    expect(getProblemUrl(100001, 'A')).toBe('https://codeforces.com/gym/100001/problem/A');
  });
});
