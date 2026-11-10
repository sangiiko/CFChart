import type { CFProblem, CFRankTier, CFRatingChange, CFSubmission, CFUser } from '../types/codeforces';

const API_BASE = 'https://codeforces.com/api';
export const REQUEST_INTERVAL_MS = 2100;

export const RANK_TIERS = [
  { name: 'Newbie', color: '#808080', tier: 'newbie' as CFRankTier, min: 0, max: 1199 },
  { name: 'Pupil', color: '#008000', tier: 'pupil' as CFRankTier, min: 1200, max: 1399 },
  { name: 'Specialist', color: '#03a89e', tier: 'specialist' as CFRankTier, min: 1400, max: 1599 },
  { name: 'Expert', color: '#0000ff', tier: 'expert' as CFRankTier, min: 1600, max: 1899 },
  { name: 'Candidate Master', color: '#aa00aa', tier: 'candidate_master' as CFRankTier, min: 1900, max: 2199 },
  { name: 'Master', color: '#ff8c00', tier: 'master' as CFRankTier, min: 2200, max: 2299 },
  { name: 'International Master', color: '#ff8c00', tier: 'international_master' as CFRankTier, min: 2300, max: 2399 },
  { name: 'Grandmaster', color: '#ff0000', tier: 'grandmaster' as CFRankTier, min: 2400, max: 2599 },
  { name: 'International Grandmaster', color: '#ff0000', tier: 'international_grandmaster' as CFRankTier, min: 2600, max: 2999 },
  { name: 'Legendary Grandmaster', color: '#ff0000', tier: 'legendary_grandmaster' as CFRankTier, min: 3000, max: 100000 },
];

export function getRankTier(rating?: number) {
  if (rating == null || !Number.isFinite(rating)) {
    return { name: 'Unrated', color: '#808080', tier: 'unrated' as CFRankTier, min: 0, max: 1199 };
  }
  return RANK_TIERS.find(tier => rating <= tier.max) ?? RANK_TIERS[RANK_TIERS.length - 1];
}

export function getProblemKey(contestId?: number, index?: string): string {
  return contestId && index ? `${contestId}-${index.toUpperCase()}` : '';
}

export function getProblemUrl(contestId?: number, index?: string): string {
  if (!contestId || !index) return 'https://codeforces.com/problemset';
  return contestId >= 100000
    ? `https://codeforces.com/gym/${contestId}/problem/${encodeURIComponent(index)}`
    : `https://codeforces.com/problemset/problem/${contestId}/${encodeURIComponent(index)}`;
}

export class CodeforcesApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly retryable = false) {
    super(message);
    this.name = 'CodeforcesApiError';
  }
}

export function normalizeHandle(handle: string): string {
  if (typeof handle !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(handle.trim())) {
    throw new CodeforcesApiError('Enter a valid Codeforces handle.', 'invalid_handle');
  }
  return handle.trim();
}

interface ApiOptions {
  fetch?: typeof fetch;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

/** Instantiate once, in the background, so every tab shares one request queue. */
export function createCodeforcesApi(options: ApiOptions = {}) {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  // An MV3 event background can restart immediately after another instance sent a
  // request. A startup cooldown preserves spacing across those lifecycles too.
  let lastStartedAt = now();
  let queue: Promise<void> = Promise.resolve();
  const inFlight = new Map<string, Promise<unknown>>();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(async () => {
      const delay = Math.max(0, REQUEST_INTERVAL_MS - (now() - lastStartedAt));
      if (delay) await wait(delay);
      lastStartedAt = now();
      return operation();
    });
    queue = result.then(() => {}, () => {});
    return result;
  }

  async function fetchOnce<T>(url: string): Promise<T> {
    const controller = new AbortController();
    // Include reading the response body in the timeout.
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetchFn(url, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) {
        throw new CodeforcesApiError(`Codeforces returned HTTP ${response.status}. Try again shortly.`, 'http_error', response.status === 429 || response.status >= 500);
      }
      let data: { status?: string; result?: T; comment?: string };
      try {
        data = await response.json() as typeof data;
      } catch {
        throw new CodeforcesApiError('Codeforces returned an unreadable response. Try again shortly.', 'invalid_response');
      }
      if (data.status !== 'OK' || data.result === undefined) {
        const limited = /limit|too many/i.test(data.comment ?? '');
        throw new CodeforcesApiError(data.comment || 'Codeforces could not complete the request.', limited ? 'rate_limited' : 'api_error', limited);
      }
      return data.result;
    } catch (error) {
      if (error instanceof CodeforcesApiError) throw error;
      if (controller.signal.aborted) throw new CodeforcesApiError('Codeforces took too long to respond. Try again.', 'timeout', true);
      throw new CodeforcesApiError('Could not connect to Codeforces. Check your connection and retry.', 'network_error', true);
    } finally {
      clearTimeout(timer);
    }
  }

  function request<T>(method: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = `${API_BASE}/${method}?${new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]))}`;
    const existing = inFlight.get(url);
    if (existing) return existing as Promise<T>;
    const operation = (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await enqueue(() => fetchOnce<T>(url));
        } catch (error) {
          if (!(error instanceof CodeforcesApiError) || !error.retryable || attempt >= 2) throw error;
          await wait(REQUEST_INTERVAL_MS * (attempt + 1));
        }
      }
    })();
    inFlight.set(url, operation);
    void operation.finally(() => inFlight.delete(url)).catch(() => {});
    return operation;
  }

  return {
    async fetchUserInfo(handle: string): Promise<CFUser> {
      const users = await request<CFUser[]>('user.info', { handles: normalizeHandle(handle) });
      const user = Array.isArray(users) ? users[0] : undefined;
      if (!user?.handle) throw new CodeforcesApiError('Codeforces did not return this profile.', 'invalid_response');
      return user;
    },
    async fetchUserRatingHistory(handle: string): Promise<CFRatingChange[]> {
      const history = await request<CFRatingChange[]>('user.rating', { handle: normalizeHandle(handle) });
      if (!Array.isArray(history) || history.some(item => !Number.isFinite(item.ratingUpdateTimeSeconds) || !Number.isFinite(item.newRating))) {
        throw new CodeforcesApiError('Codeforces returned invalid rating history.', 'invalid_response');
      }
      return history;
    },
    async fetchSubmissionPage(handle: string, from = 1, count = 1000): Promise<CFSubmission[]> {
      const submissions = await request<CFSubmission[]>('user.status', { handle: normalizeHandle(handle), from, count });
      if (!Array.isArray(submissions) || submissions.some(item => !Number.isFinite(item.id) || !Number.isFinite(item.creationTimeSeconds) || !item.problem?.name)) {
        throw new CodeforcesApiError('Codeforces returned invalid submission history.', 'invalid_response');
      }
      return submissions.map(submission => ({
        id: submission.id,
        creationTimeSeconds: submission.creationTimeSeconds,
        verdict: submission.verdict,
        problem: {
          contestId: submission.problem.contestId,
          index: submission.problem.index,
          name: submission.problem.name,
          rating: submission.problem.rating,
          tags: submission.problem.tags ?? [],
        },
        author: submission.author ? {
          participantType: submission.author.participantType,
          members: submission.author.members?.map(member => ({ handle: member.handle })),
        } : undefined,
      }));
    },
    async fetchProblemCatalog(): Promise<CFProblem[]> {
      const result = await request<{ problems: CFProblem[]; problemStatistics: { contestId?: number; index: string; solvedCount: number }[] }>('problemset.problems');
      if (!Array.isArray(result.problems) || !Array.isArray(result.problemStatistics)) throw new CodeforcesApiError('Codeforces returned an invalid problem catalog.', 'invalid_response');
      const stats = new Map(result.problemStatistics.map(s => [`${s.contestId}-${s.index}`, s.solvedCount]));
      return result.problems
        .filter(problem => problem.contestId && problem.index && Number.isFinite(problem.rating) && Array.isArray(problem.tags))
        .map(problem => ({ ...problem, solvedCount: stats.get(`${problem.contestId}-${problem.index}`) }));
    },
    async fetchContestList(): Promise<CFContest[]> {
      const contests = await request<CFContest[]>('contest.list', { gym: false });
      if (!Array.isArray(contests)) throw new CodeforcesApiError('Codeforces returned an invalid contest list.', 'invalid_response');
      return contests;
    },
  };
}

export const codeforcesApi = createCodeforcesApi();
