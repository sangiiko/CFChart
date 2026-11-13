import type { SessionEvent } from './session';
import type { CFProblem, RecommendedProblem } from '../types/codeforces';
import type { AcceptanceHistory } from './features';

export interface EnrichedProblem extends CFProblem {
  solvedCount: number;
  contestType?: string;
  contestPhase?: string;
  contestStart?: number;
  qualityScore: number;
}
export type PracticeOutcome = 'independent' | 'assisted' | 'timeout' | 'skipped' | 'interrupted' | 'already-solved' | 'accepted';
export type PracticeProvenance = 'self-report' | 'codeforces-api';
export interface PracticeFeedback {
  id: string;
  problemKey: string;
  outcome: PracticeOutcome;
  /** Explicit self-report or timer measurement, never inferred from submission timestamps. */
  minutes?: number;
  assistance?: 'independent' | 'assisted' | 'unknown';
}
export interface PracticeEvent extends PracticeFeedback {
  version: 1;
  timestamp: number;
  problem: RecommendedProblem;
  provenance: PracticeProvenance;
  timing?: { source: 'explicit-timer'; elapsedMs: number; assistanceAtMs: number | null };
}
export interface Candidate {
  item: RecommendedProblem;
  score: number;
  marginal?: number;
  shadowAcceptance?: number;
}
export interface PracticeAssignment {
  id: string;
  timestamp: number;
  policy: 'adaptive-baseline-v1';
  problem: RecommendedProblem;
  rating: number;
  historyComplete: boolean;
  /** Deterministic baseline assignment; does not support evaluation of other actions. */
  selectionProbability: 1;
}
export interface PracticeImpression { id: string; day: string; problemKey: string; displayedAt: number; position: number }
export interface PracticeLedger { removedSolves?: { day: string; problemKey: string }[]; version: 1; events: PracticeEvent[]; sessions?: SessionEvent[]; assignments?: PracticeAssignment[]; impressions?: PracticeImpression[] }
export interface PracticePlan {
  version: 1;
  policy: 'adaptive-baseline-v1';
  day: string;
  budget: number;
  target: number;
  items: RecommendedProblem[];
}
export interface UserPracticeState {
  solved: Set<string>;
  attempted: Map<string, { lastAttempt: number; count: number }>;
  participatedContests: Set<number>;
  tagActivity: Map<string, { accepted: number; total: number }>;
  recentRating: number;
  historyComplete: boolean;
  events: PracticeEvent[];
  now: number;
  mode?: 'adaptive' | 'timed' | 'guided' | 'transfer';
  acceptanceHistory?: AcceptanceHistory | null;
}
export interface SkillProfile {
  globalTheta: number;
  tagTheta: Map<string, number>;
  evidenceCount: number;
}
