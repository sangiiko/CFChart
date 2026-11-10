import { CFUser, CFRatingChange, CFSubmission, RecommendedProblem, CFRankTier } from '../types/codeforces';

const API_BASE = 'https://codeforces.com/api';

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
  { name: 'Legendary Grandmaster', color: '#ff0000', tier: 'legendary_grandmaster' as CFRankTier, min: 3000, max: 4000 },
];

export function getRankTier(rating?: number) {
  if (rating === undefined || rating === null) {
    return { name: 'Unrated', color: '#808080', tier: 'unrated' as CFRankTier, min: 0, max: 1199 };
  }
  for (const tier of RANK_TIERS) {
    if (rating >= tier.min && rating <= tier.max) {
      return tier;
    }
  }
  return RANK_TIERS[RANK_TIERS.length - 1];
}

export function getProblemKey(contestId?: number, index?: string): string {
  if (!contestId || !index) return '';
  return `${contestId}-${index.toUpperCase()}`;
}

export function getProblemUrl(contestId?: number, index?: string): string {
  if (!contestId || !index) return 'https://codeforces.com/problemset';
  return `https://codeforces.com/problemset/problem/${contestId}/${index}`;
}

async function fetchWithTimeout(url: string, timeoutMs: number = 7000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export const codeforcesApi = {
  async fetchUserInfo(handle: string): Promise<CFUser | null> {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/user.info?handles=${encodeURIComponent(handle)}`);
      if (!res.ok) {
        throw new Error(`CF API returned ${res.status}`);
      }
      const data = await res.json();
      if (data.status === 'OK' && data.result && data.result.length > 0) {
        return data.result[0] as CFUser;
      }
      return null;
    } catch (err) {
      console.warn('Failed to fetch CF user info:', err);
      return null;
    }
  },

  async fetchUserRatingHistory(handle: string): Promise<CFRatingChange[]> {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/user.rating?handle=${encodeURIComponent(handle)}`);
      if (!res.ok) {
        throw new Error(`CF API returned ${res.status}`);
      }
      const data = await res.json();
      if (data.status === 'OK' && Array.isArray(data.result)) {
        return data.result as CFRatingChange[];
      }
      return [];
    } catch (err) {
      console.warn('Failed to fetch rating history:', err);
      return [];
    }
  },

  async fetchUserSubmissions(handle: string, count: number = 200): Promise<CFSubmission[]> {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/user.status?handle=${encodeURIComponent(handle)}&from=1&count=${count}`);
      if (!res.ok) {
        throw new Error(`CF API returned ${res.status}`);
      }
      const data = await res.json();
      if (data.status === 'OK' && Array.isArray(data.result)) {
        return data.result as CFSubmission[];
      }
      return [];
    } catch (err) {
      console.warn('Failed to fetch user submissions:', err);
      return [];
    }
  },

  async fetchRecommendedProblems(
    currentRating: number,
    solvedKeys: Set<string>
  ): Promise<RecommendedProblem[]> {
    const baseRating = Math.max(800, currentRating || 1200);
    const roundedRating = Math.round(baseRating / 100) * 100;
    const warmupRating = Math.max(800, roundedRating);
    const challengeRating = roundedRating + 200;

    const classicProblems: RecommendedProblem[] = [
      { contestId: 158, index: 'A', name: 'Next Round', rating: 800, tags: ['implementation'], type: 'warmup', url: getProblemUrl(158, 'A') },
      { contestId: 71, index: 'A', name: 'Way Too Long Words', rating: 800, tags: ['strings'], type: 'warmup', url: getProblemUrl(71, 'A') },
      { contestId: 231, index: 'A', name: 'Team', rating: 800, tags: ['brute force'], type: 'warmup', url: getProblemUrl(231, 'A') },
      { contestId: 282, index: 'A', name: 'Bit++', rating: 800, tags: ['implementation'], type: 'warmup', url: getProblemUrl(282, 'A') },
      { contestId: 4, index: 'A', name: 'Watermelon', rating: 800, tags: ['math'], type: 'warmup', url: getProblemUrl(4, 'A') },
      { contestId: 118, index: 'A', name: 'String Task', rating: 1000, tags: ['strings'], type: 'warmup', url: getProblemUrl(118, 'A') },
      { contestId: 69, index: 'A', name: 'Young Physicist', rating: 1000, tags: ['math'], type: 'warmup', url: getProblemUrl(69, 'A') },
      { contestId: 479, index: 'A', name: 'Expression', rating: 1000, tags: ['math', 'brute force'], type: 'warmup', url: getProblemUrl(479, 'A') },
      { contestId: 136, index: 'A', name: 'Presents', rating: 800, tags: ['implementation'], type: 'warmup', url: getProblemUrl(136, 'A') },
      { contestId: 160, index: 'A', name: 'Twins', rating: 900, tags: ['greedy'], type: 'warmup', url: getProblemUrl(160, 'A') },
      { contestId: 96, index: 'A', name: 'Football', rating: 900, tags: ['strings'], type: 'warmup', url: getProblemUrl(96, 'A') },
      { contestId: 339, index: 'A', name: 'Helpful Maths', rating: 800, tags: ['greedy', 'strings'], type: 'warmup', url: getProblemUrl(339, 'A') },
      { contestId: 263, index: 'A', name: 'Beautiful Matrix', rating: 800, tags: ['implementation'], type: 'warmup', url: getProblemUrl(263, 'A') },
      { contestId: 189, index: 'A', name: 'Cut Ribbon', rating: 1300, tags: ['dp'], type: 'warmup', url: getProblemUrl(189, 'A') },
      { contestId: 455, index: 'A', name: 'Boredom', rating: 1500, tags: ['dp'], type: 'challenge', url: getProblemUrl(455, 'A') },
      { contestId: 580, index: 'C', name: 'Kefa and Park', rating: 1500, tags: ['trees', 'dfs and similar'], type: 'challenge', url: getProblemUrl(580, 'C') },
      { contestId: 1352, index: 'C', name: 'K-th Not Divisible by n', rating: 1200, tags: ['math', 'binary search'], type: 'warmup', url: getProblemUrl(1352, 'C') },
      { contestId: 1335, index: 'C', name: 'Two Teams Composing', rating: 1100, tags: ['greedy', 'binary search'], type: 'warmup', url: getProblemUrl(1335, 'C') },
      { contestId: 1328, index: 'B', name: 'K-th Beautiful String', rating: 1300, tags: ['binary search', 'math'], type: 'warmup', url: getProblemUrl(1328, 'B') },
      { contestId: 1360, index: 'D', name: 'Buying Shovels', rating: 1300, tags: ['number theory', 'math'], type: 'warmup', url: getProblemUrl(1360, 'D') },
      { contestId: 1360, index: 'E', name: 'Polygon', rating: 1300, tags: ['dp', 'greedy'], type: 'warmup', url: getProblemUrl(1360, 'E') },
      { contestId: 1374, index: 'D', name: 'Zero Remainder Array', rating: 1400, tags: ['math', 'sortings'], type: 'challenge', url: getProblemUrl(1374, 'D') },
      { contestId: 1363, index: 'B', name: 'Subsequence Hate', rating: 1400, tags: ['strings'], type: 'challenge', url: getProblemUrl(1363, 'B') },
      { contestId: 1475, index: 'C', name: 'Ball in Berland', rating: 1400, tags: ['combinatorics', 'graphs'], type: 'challenge', url: getProblemUrl(1475, 'C') },
      { contestId: 1352, index: 'D', name: 'Alice, Bob and Candies', rating: 1300, tags: ['implementation', 'two pointers'], type: 'warmup', url: getProblemUrl(1352, 'D') },
      { contestId: 1343, index: 'C', name: 'Alternating Subsequence', rating: 1200, tags: ['dp', 'greedy', 'two pointers'], type: 'warmup', url: getProblemUrl(1343, 'C') },
      { contestId: 1354, index: 'B', name: 'Ternary String', rating: 1200, tags: ['binary search', 'two pointers'], type: 'warmup', url: getProblemUrl(1354, 'B') },
      { contestId: 1324, index: 'D', name: 'Pair of Topics', rating: 1400, tags: ['binary search', 'sortings'], type: 'challenge', url: getProblemUrl(1324, 'D') },
      { contestId: 1370, index: 'C', name: 'Number Game', rating: 1400, tags: ['games', 'math', 'number theory'], type: 'challenge', url: getProblemUrl(1370, 'C') },
      { contestId: 1385, index: 'D', name: 'a-Good String', rating: 1500, tags: ['bitmasks', 'divide and conquer', 'dp'], type: 'challenge', url: getProblemUrl(1385, 'D') },
      { contestId: 1409, index: 'D', name: 'Decrease the Sum of Digits', rating: 1500, tags: ['greedy', 'math'], type: 'challenge', url: getProblemUrl(1409, 'D') },
      { contestId: 1520, index: 'E', name: 'Arranging The Sheep', rating: 1400, tags: ['greedy', 'math'], type: 'challenge', url: getProblemUrl(1520, 'E') },
      { contestId: 1551, index: 'B2', name: 'Wonderful Coloring - 2', rating: 1400, tags: ['binary search', 'greedy'], type: 'challenge', url: getProblemUrl(1551, 'B2') },
      { contestId: 1526, index: 'B', name: 'I Hate 1111', rating: 1400, tags: ['dp', 'math', 'number theory'], type: 'challenge', url: getProblemUrl(1526, 'B') },
      { contestId: 1538, index: 'C', name: 'Number of Pairs', rating: 1300, tags: ['binary search', 'two pointers'], type: 'warmup', url: getProblemUrl(1538, 'C') },
      { contestId: 1618, index: 'D', name: 'Array and Operations', rating: 1300, tags: ['dp', 'greedy'], type: 'warmup', url: getProblemUrl(1618, 'D') },
      { contestId: 1619, index: 'C', name: 'Wrong Addition', rating: 1200, tags: ['implementation'], type: 'warmup', url: getProblemUrl(1619, 'C') },
      { contestId: 1669, index: 'F', name: 'Eating Candies', rating: 1100, tags: ['binary search', 'two pointers'], type: 'warmup', url: getProblemUrl(1669, 'F') },
      { contestId: 1676, index: 'F', name: 'Longest Strike', rating: 1300, tags: ['data structures', 'greedy'], type: 'warmup', url: getProblemUrl(1676, 'F') },
      { contestId: 1703, index: 'F', name: 'Yet Another Problem About Pairs Satisfying an Inequality', rating: 1300, tags: ['binary search', 'data structures'], type: 'warmup', url: getProblemUrl(1703, 'F') },
      { contestId: 1742, index: 'E', name: 'Scuza', rating: 1200, tags: ['binary search', 'greedy'], type: 'warmup', url: getProblemUrl(1742, 'E') },
      { contestId: 1791, index: 'G1', name: 'Teleporters (Easy Version)', rating: 1100, tags: ['greedy', 'sortings'], type: 'warmup', url: getProblemUrl(1791, 'G1') },
      { contestId: 1807, index: 'G1', name: 'Subsequence Addition (Easy Version)', rating: 1100, tags: ['dp', 'greedy'], type: 'warmup', url: getProblemUrl(1807, 'G1') },
      { contestId: 1829, index: 'F', name: 'Forever Winter', rating: 1200, tags: ['dfs and similar', 'graphs'], type: 'warmup', url: getProblemUrl(1829, 'F') },
      { contestId: 1850, index: 'F', name: 'We Were Both Children', rating: 1300, tags: ['math', 'number theory'], type: 'warmup', url: getProblemUrl(1850, 'F') },
      { contestId: 1873, index: 'F', name: 'Money Trees', rating: 1300, tags: ['binary search', 'two pointers'], type: 'warmup', url: getProblemUrl(1873, 'F') },
      { contestId: 1915, index: 'E', name: 'Romantic Glasses', rating: 1300, tags: ['data structures', 'math'], type: 'warmup', url: getProblemUrl(1915, 'E') },
      { contestId: 1927, index: 'D', name: 'Find the Different Ones!', rating: 1300, tags: ['binary search', 'data structures'], type: 'warmup', url: getProblemUrl(1927, 'D') },
      { contestId: 1941, index: 'D', name: 'Rudolf and the Ball Game', rating: 1300, tags: ['dp'], type: 'warmup', url: getProblemUrl(1941, 'D') },
      { contestId: 1950, index: 'E', name: 'Nearly Shortest Repeating Substring', rating: 1500, tags: ['brute force', 'strings'], type: 'challenge', url: getProblemUrl(1950, 'E') },
      { contestId: 1971, index: 'E', name: 'Find the Car', rating: 1300, tags: ['binary search', 'math'], type: 'warmup', url: getProblemUrl(1971, 'E') },
      { contestId: 1985, index: 'F', name: 'Final Boss', rating: 1500, tags: ['binary search', 'data structures'], type: 'challenge', url: getProblemUrl(1985, 'F') },
      { contestId: 1999, index: 'E', name: 'Triple Operations', rating: 1300, tags: ['dp', 'greedy', 'math'], type: 'warmup', url: getProblemUrl(1999, 'E') },
      { contestId: 2000, index: 'E', name: 'Photoshoot for Gorillas', rating: 1400, tags: ['greedy', 'math', 'sortings'], type: 'challenge', url: getProblemUrl(2000, 'E') },
      { contestId: 2008, index: 'E', name: 'Alternating String', rating: 1500, tags: ['brute force', 'strings'], type: 'challenge', url: getProblemUrl(2008, 'E') },
      { contestId: 2014, index: 'D', name: 'Robert Hood and Mrs Hood', rating: 1500, tags: ['binary search', 'data structures'], type: 'challenge', url: getProblemUrl(2014, 'D') },
      { contestId: 2026, index: 'C', name: 'Action Figures', rating: 1600, tags: ['binary search', 'greedy'], type: 'challenge', url: getProblemUrl(2026, 'C') },
      { contestId: 2033, index: 'E', name: 'Sakurako, Kosuke, and the Permutation', rating: 1500, tags: ['dfs and similar', 'graphs'], type: 'challenge', url: getProblemUrl(2033, 'E') },
    ];

    const unsolved = classicProblems.filter(p => !solvedKeys.has(getProblemKey(p.contestId, p.index)));

    const warmups = unsolved
      .filter(p => Math.abs(p.rating - warmupRating) <= 200)
      .sort((a, b) => Math.abs(a.rating - warmupRating) - Math.abs(b.rating - warmupRating));
    const warmup = warmups[0] || unsolved[0] || classicProblems[0];

    const challenges = unsolved
      .filter(p => p !== warmup && Math.abs(p.rating - challengeRating) <= 200)
      .sort((a, b) => Math.abs(a.rating - challengeRating) - Math.abs(b.rating - challengeRating));
    const challenge = challenges[0] || unsolved.find(p => p !== warmup) || classicProblems[classicProblems.length - 1];

    return [
      { ...warmup, type: 'warmup' },
      { ...challenge, type: 'challenge' }
    ];
  }
};
