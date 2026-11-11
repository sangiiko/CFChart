import type { SessionAction } from '../recommender/session';
import type { PracticeFeedback } from '../recommender/types';
import type { CFContest, CFProblem, CFRatingChange, CFSubmission, CFUser, HabitProgress, PredictionParams, RecommendedProblem } from './codeforces';

export interface Preferences {
  personalHandle: string | null;
  dailyTarget: number;
  practiceMinutes?: number;
  practiceMode?: 'adaptive' | 'timed' | 'guided' | 'transfer';
  predictionParams: PredictionParams;
  chartView: 'enhanced' | 'original';
}

export interface HistoryCoverage {
  complete: boolean;
  /** Unix seconds of the oldest fetched submission. Earlier days are unknown. */
  earliestTime?: number;
  loaded: number;
  /** Milliseconds when the entire solved index was last checked. */
  lastFullSyncAt?: number;
}

export interface ProfileSnapshot {
  handle: string;
  user: CFUser;
  ratings: CFRatingChange[];
  updatedAt: number;
  error?: string;
  stale?: boolean;
}

export interface PracticeSnapshot {
  handle: string;
  submissions: CFSubmission[];
  progress: HabitProgress;
  recommendations: RecommendedProblem[];
  updatedAt: number;
  error?: string;
  stale?: boolean;
  coverage: HistoryCoverage;
}

export interface CachedPractice {
  handle: string;
  submissions: CFSubmission[];
  complete: boolean;
  updatedAt: number;
  lastFullSyncAt?: number;
  /** Ordered prefix checked during a bounded full-history revalidation. */
  syncIds?: number[];
}

export interface CachedCatalog {
  version?: 2;
  contests?: CFContest[];
  problems: CFProblem[];
  updatedAt: number;
}

export type RequestOptions = { force?: boolean; syncMore?: boolean; resetHistory?: boolean };
export type ExtensionRequest =
  | { type: 'CFCHART_REQUEST'; action: 'removeTodaySolve'; handle: string; key: string }
  | { type: 'CFCHART_REQUEST'; action: 'recordPracticeFeedback'; handle: string; feedback: PracticeFeedback }
  | { type: 'CFCHART_REQUEST'; action: 'exportPracticeData'; handle: string }
  | { type: 'CFCHART_REQUEST'; action: 'clearPracticeData'; handle: string }
  | { type: 'CFCHART_REQUEST'; action: 'practiceSession'; handle: string; key: string; event?: { id: string; action: SessionAction } }
  | { type: 'CFCHART_REQUEST'; action: 'getPreferences' }
  | { type: 'CFCHART_REQUEST'; action: 'updatePreferences'; preferences: Partial<Preferences> }
  | { type: 'CFCHART_REQUEST'; action: 'detectViewer'; handle: string }
  | { type: 'CFCHART_REQUEST'; action: 'getProfile'; handle: string; options?: RequestOptions }
  | { type: 'CFCHART_REQUEST'; action: 'getPractice'; handle: string; options?: RequestOptions };

export type ExtensionResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string; code?: string };
