import type { PracticeEvent } from './types';

const DAY_MS = 86_400_000;

/**
 * 8-dimensional algorithmic concept space for Codeforces problem tags:
 * [0] DP & State Transitions
 * [1] Graphs & Tree Topology
 * [2] Data Structures & Range Queries
 * [3] Math, Number Theory & Algebra
 * [4] Greedy, Constructive & Game Strategy
 * [5] Strings, Hashing & Automata
 * [6] Search, Two Pointers & Optimization
 * [7] Geometry, Interactive & Implementation
 */
export const TAG_CONCEPT_VECTORS: Readonly<Record<string, readonly number[]>> = Object.freeze({
  'dp': [0.95, 0.10, 0.15, 0.15, 0.15, 0.05, 0.15, 0.05],
  'bitmasks': [0.75, 0.05, 0.10, 0.25, 0.10, 0.00, 0.35, 0.15],
  'divide and conquer': [0.50, 0.15, 0.45, 0.20, 0.10, 0.00, 0.55, 0.05],
  'probabilities': [0.65, 0.05, 0.00, 0.75, 0.05, 0.00, 0.00, 0.00],
  'graphs': [0.15, 0.95, 0.20, 0.05, 0.10, 0.00, 0.15, 0.05],
  'trees': [0.35, 0.90, 0.35, 0.05, 0.10, 0.00, 0.10, 0.05],
  'dfs and similar': [0.20, 0.85, 0.15, 0.00, 0.15, 0.00, 0.25, 0.15],
  'shortest paths': [0.30, 0.90, 0.30, 0.05, 0.15, 0.00, 0.20, 0.05],
  'dsu': [0.05, 0.75, 0.70, 0.05, 0.15, 0.00, 0.10, 0.05],
  'flows': [0.15, 0.90, 0.25, 0.15, 0.10, 0.00, 0.25, 0.00],
  'graph matchings': [0.20, 0.90, 0.20, 0.15, 0.10, 0.00, 0.15, 0.00],
  '2-sat': [0.10, 0.85, 0.15, 0.15, 0.20, 0.00, 0.10, 0.05],
  'data structures': [0.20, 0.25, 0.95, 0.05, 0.15, 0.05, 0.25, 0.10],
  'binary search': [0.15, 0.05, 0.35, 0.10, 0.25, 0.00, 0.90, 0.05],
  'ternary search': [0.10, 0.00, 0.10, 0.35, 0.10, 0.00, 0.85, 0.35],
  'two pointers': [0.10, 0.00, 0.40, 0.05, 0.35, 0.05, 0.80, 0.15],
  'meet-in-the-middle': [0.35, 0.05, 0.20, 0.20, 0.05, 0.00, 0.85, 0.05],
  'brute force': [0.15, 0.15, 0.05, 0.10, 0.10, 0.05, 0.75, 0.45],
  'sortings': [0.05, 0.00, 0.45, 0.05, 0.65, 0.05, 0.55, 0.25],
  'greedy': [0.15, 0.05, 0.20, 0.10, 0.95, 0.00, 0.25, 0.15],
  'constructive algorithms': [0.10, 0.15, 0.10, 0.25, 0.90, 0.05, 0.10, 0.30],
  'games': [0.55, 0.20, 0.05, 0.35, 0.75, 0.00, 0.10, 0.05],
  'schedules': [0.35, 0.05, 0.30, 0.10, 0.85, 0.00, 0.35, 0.05],
  'math': [0.15, 0.05, 0.05, 0.95, 0.20, 0.00, 0.10, 0.05],
  'number theory': [0.10, 0.05, 0.05, 0.95, 0.10, 0.00, 0.15, 0.05],
  'combinatorics': [0.50, 0.05, 0.05, 0.90, 0.10, 0.05, 0.05, 0.00],
  'matrices': [0.55, 0.15, 0.10, 0.85, 0.00, 0.00, 0.05, 0.00],
  'fft': [0.35, 0.00, 0.10, 0.90, 0.00, 0.15, 0.15, 0.00],
  'chinese remainder theorem': [0.05, 0.00, 0.00, 0.95, 0.05, 0.00, 0.05, 0.00],
  'strings': [0.20, 0.05, 0.20, 0.05, 0.10, 0.95, 0.15, 0.15],
  'hashing': [0.10, 0.05, 0.40, 0.20, 0.05, 0.85, 0.25, 0.05],
  'string suffix structures': [0.20, 0.10, 0.55, 0.05, 0.00, 0.95, 0.20, 0.00],
  'expression parsing': [0.15, 0.10, 0.25, 0.10, 0.05, 0.80, 0.10, 0.55],
  'geometry': [0.05, 0.05, 0.15, 0.40, 0.10, 0.00, 0.25, 0.90],
  'interactive': [0.05, 0.10, 0.10, 0.10, 0.35, 0.00, 0.55, 0.70],
  'implementation': [0.05, 0.05, 0.15, 0.05, 0.20, 0.15, 0.15, 0.90],
});

/**
 * Empirical Inverse Document Frequency (IDF) specificity weights in [0.30, 1.00].
 * Specific algorithmic techniques carry more diagnostic signal than broad umbrella tags.
 */
export const TAG_IDF_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  'implementation': 0.32,
  'greedy': 0.38,
  'math': 0.42,
  'brute force': 0.48,
  'constructive algorithms': 0.50,
  'sortings': 0.54,
  'dp': 0.62,
  'data structures': 0.64,
  'binary search': 0.65,
  'dfs and similar': 0.66,
  'graphs': 0.68,
  'trees': 0.70,
  'strings': 0.70,
  'number theory': 0.72,
  'two pointers': 0.73,
  'combinatorics': 0.75,
  'bitmasks': 0.76,
  'dsu': 0.78,
  'shortest paths': 0.80,
  'games': 0.80,
  'interactive': 0.80,
  'probabilities': 0.82,
  'divide and conquer': 0.83,
  'hashing': 0.84,
  'geometry': 0.85,
  'matrices': 0.88,
  'ternary search': 0.89,
  'flows': 0.91,
  'meet-in-the-middle': 0.91,
  'graph matchings': 0.92,
  'expression parsing': 0.93,
  '2-sat': 0.94,
  'fft': 0.95,
  'string suffix structures': 0.96,
  'schedules': 0.96,
  'chinese remainder theorem': 0.98,
});

/**
 * Directed pedagogical prerequisite relationships: advanced technique -> foundational concepts.
 */
export const TECHNIQUE_PREREQUISITES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'trees': ['dfs and similar'],
  'shortest paths': ['graphs', 'dfs and similar'],
  'dsu': ['graphs', 'data structures'],
  'flows': ['graphs', 'shortest paths'],
  'graph matchings': ['graphs', 'dfs and similar'],
  '2-sat': ['graphs', 'dfs and similar'],
  'bitmasks': ['dp', 'implementation'],
  'divide and conquer': ['binary search', 'dp'],
  'probabilities': ['dp', 'math', 'combinatorics'],
  'combinatorics': ['math', 'number theory'],
  'matrices': ['math', 'dp'],
  'fft': ['math', 'divide and conquer'],
  'chinese remainder theorem': ['number theory', 'math'],
  'hashing': ['strings', 'data structures'],
  'string suffix structures': ['strings', 'hashing', 'data structures'],
  'two pointers': ['sortings', 'binary search'],
  'ternary search': ['binary search', 'math'],
  'meet-in-the-middle': ['binary search', 'bitmasks'],
  'schedules': ['greedy', 'sortings'],
});

export function tagInformationWeight(tag: string): number {
  return TAG_IDF_WEIGHTS[tag.toLowerCase()] ?? 0.75;
}

/** Compute L2-normalized 8D algorithmic concept embedding for a tag list. */
export function problemEmbedding(tags: readonly string[]): number[] {
  const dim = 8;
  const vec = new Array<number>(dim).fill(0);
  if (!tags.length) return vec;
  for (const rawTag of tags) {
    const tag = rawTag.toLowerCase();
    const weight = tagInformationWeight(tag);
    const concept = TAG_CONCEPT_VECTORS[tag];
    if (concept) {
      for (let i = 0; i < dim; i++) vec[i] += weight * concept[i];
    } else {
      // Deterministic hash projection for unseen/custom tags
      let hash = 2166136261;
      for (let i = 0; i < tag.length; i++) {
        hash ^= tag.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      const bucket = Math.abs(hash) % dim;
      vec[bucket] += weight;
    }
  }
  const norm = Math.hypot(...vec);
  return norm > 1e-12 ? vec.map(v => v / norm) : vec;
}

/**
 * Compute semantic similarity in [0, 1] between two problem tag sets,
 * blending IDF-weighted Jaccard overlap and 8D concept cosine similarity.
 */
export function semanticTagSimilarity(tagsA: readonly string[], tagsB: readonly string[]): number {
  if (!tagsA.length || !tagsB.length) return 0;
  const setA = new Set(tagsA.map(t => t.toLowerCase()));
  const setB = new Set(tagsB.map(t => t.toLowerCase()));
  let intersectionWeight = 0;
  let unionWeight = 0;
  const allTags = new Set([...setA, ...setB]);
  for (const tag of allTags) {
    const w = tagInformationWeight(tag);
    unionWeight += w;
    if (setA.has(tag) && setB.has(tag)) intersectionWeight += w;
  }
  const idfJaccard = unionWeight > 0 ? intersectionWeight / unionWeight : 0;

  const embA = problemEmbedding(tagsA);
  const embB = problemEmbedding(tagsB);
  let cosine = 0;
  for (let i = 0; i < embA.length; i++) cosine += embA[i] * embB[i];
  cosine = Math.max(0, Math.min(1, cosine));

  return 0.55 * idfJaccard + 0.45 * cosine;
}

/** Combined semantic technique + difficulty similarity between two problems in [0, 1]. */
export function problemSimilarity(
  a: { tags: readonly string[]; rating?: number },
  b: { tags: readonly string[]; rating?: number }
): number {
  const tagSim = semanticTagSimilarity(a.tags, b.tags);
  if (!Number.isFinite(a.rating) || !Number.isFinite(b.rating)) return tagSim;
  const diffSim = Math.exp(-0.5 * ((a.rating! - b.rating!) / 250) ** 2);
  return 0.75 * tagSim + 0.25 * diffSim;
}

/**
 * Select the learner's most critical weak tag on a problem (theta < target - 30),
 * prioritizing the deepest skill deficit and higher algorithmic specificity.
 */
export function selectMostInformativeWeakTag(
  tags: readonly string[],
  tagTheta: ReadonlyMap<string, number>,
  target: number
): string | undefined {
  let bestTag: string | undefined;
  let bestScore = -Infinity;
  for (const tag of tags) {
    const theta = tagTheta.get(tag) ?? target;
    if (theta >= target - 30) continue;
    const deficit = target - theta;
    // Combine deficit magnitude with specificity so core algorithmic bottlenecks lead
    const score = deficit + 15 * tagInformationWeight(tag);
    if (score > bestScore) {
      bestScore = score;
      bestTag = tag;
    }
  }
  return bestTag;
}

/**
 * Evaluate how well a transfer candidate probes the techniques of earlier assisted solves.
 * Returns a score in [0, 1].
 */
export function transferSimilarityScore(
  candidate: { tags: readonly string[]; rating?: number },
  events: readonly PracticeEvent[],
  now: number
): number {
  if (!candidate.tags.length) return 0;
  let best = 0;
  for (const e of events) {
    if (e.outcome !== 'assisted' || e.timestamp > now || now - e.timestamp < 3 * DAY_MS) continue;
    const ageDays = (now - e.timestamp) / DAY_MS;
    const recencyWeight = Math.exp(-Math.max(0, ageDays - 3) / 60);
    const sim = problemSimilarity(candidate, e.problem) * recencyWeight;
    if (sim > best) best = sim;
  }
  return Math.max(0, Math.min(1, best));
}
