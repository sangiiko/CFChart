import type { CFProblem } from '../types/codeforces';

export interface EnrichedProblem extends CFProblem {
  solvedCount: number;
  contestType?: string;
  contestPhase?: string;
  isModern: boolean; // post-2016
  qualityScore: number;
}

export interface UserPracticeState {
  solved: Set<string>;
  attempted: Map<string, { lastAttempt: number; count: number }>;
  participatedContests: Set<number>;
  tagActivity: Map<string, { accepted: number; total: number }>;
  recentRating: number;
}

export interface SkillProfile {
  globalTheta: number; // Effective rating estimate
  tagTheta: Map<string, number>; // Tag-specific skill estimate
}
