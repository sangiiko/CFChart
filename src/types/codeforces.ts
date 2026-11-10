export type CFRankTier =
  | 'unrated'
  | 'newbie'
  | 'pupil'
  | 'specialist'
  | 'expert'
  | 'candidate_master'
  | 'master'
  | 'international_master'
  | 'grandmaster'
  | 'international_grandmaster'
  | 'legendary_grandmaster';

export interface CFUser {
  handle: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
  maxRank?: string;
  titlePhoto?: string;
  avatar?: string;
  contribution?: number;
}

export interface CFRatingChange {
  contestId: number;
  contestName: string;
  handle: string;
  rank: number;
  ratingUpdateTimeSeconds: number;
  oldRating: number;
  newRating: number;
}

export interface CFProblem {
  contestId?: number;
  index: string;
  name: string;
  type?: string;
  rating?: number;
  tags: string[];
}

export interface CFSubmission {
  id: number;
  contestId?: number;
  creationTimeSeconds: number;
  relativeTimeSeconds?: number;
  problem: CFProblem;
  programmingLanguage?: string;
  verdict?: string;
  passedTestCount?: number;
  author?: {
    participantType?: string;
    members?: { handle: string }[];
  };
}

export interface SolvedProblemSummary {
  key: string;
  name: string;
  contestId?: number;
  index: string;
  rating?: number;
  timestamp: number;
  url: string;
}

export interface HabitDaySummary {
  dateStr: string; // YYYY-MM-DD
  solvedCount: number;
  targetMet: boolean;
  unknown?: boolean;
}

export interface HabitProgress {
  dailyTarget: number;
  todayCount: number;
  isTodayTargetMet: boolean;
  todayProblems: SolvedProblemSummary[];
  currentStreak: number;
  recentDays: HabitDaySummary[];
  lastUpdated: number;
  historyComplete?: boolean;
  unknownBeforeDate?: string;
  streakIsLowerBound?: boolean;
}

export interface PredictionParams {
  dailyProblems: number; // default: 2
  difficultyOffset: number; // delta above rating, default: +150
  horizonMonths: number; // 3, 6, 12, default: 6
  learningRate?: number;
}

export interface ChartDataPoint {
  dateStr: string;
  timestamp: number;
  historicalRating?: number;
  predictedRating?: number;
  lowerBound?: number;
  upperBound?: number;
  contestName?: string;
  rank?: number;
  rankColor?: string;
  isPrediction?: boolean;
  milestoneTitle?: string;
}

export interface MilestoneTarget {
  rankName: string;
  threshold: number;
  color: string;
  estimatedDate: Date | null;
  daysRemaining: number | null;
  problemsRemaining: number | null;
  achieved: boolean;
}

export interface RecommendedProblem {
  contestId: number;
  index: string;
  name: string;
  rating: number;
  tags: string[];
  type: 'warmup' | 'challenge';
  url: string;
}
