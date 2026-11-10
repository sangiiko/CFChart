import { CFRatingChange, PredictionParams, ChartDataPoint, MilestoneTarget } from '../types/codeforces';
import { RANK_TIERS, getRankTier } from './codeforcesApi';

const DAY = 86_400_000;
export interface HorizonResult {
  chartData: ChartDataPoint[];
  milestones: MilestoneTarget[];
  currentRating: number | null;
  projectedRatingAtHorizon: number | null;
  totalProjectedProblems: number;
}

/** Actual contest points only. Never replace the last contest with a synthetic point. */
export function historicalChartPoints(ratings: CFRatingChange[]): ChartDataPoint[] {
  return [...ratings].sort((a, b) => a.ratingUpdateTimeSeconds - b.ratingUpdateTimeSeconds)
    .filter(item => Number.isFinite(item.newRating) && Number.isFinite(item.ratingUpdateTimeSeconds))
    .map(item => ({
      dateStr: new Date(item.ratingUpdateTimeSeconds * 1000).toISOString().slice(0, 10),
      timestamp: item.ratingUpdateTimeSeconds * 1000,
      historicalRating: item.newRating,
      contestName: item.contestName,
      rank: item.rank,
      rankColor: getRankTier(item.newRating).color,
      isPrediction: false,
    }));
}

/**
 * An illustrative practice scenario, not a trained forecast or a calibrated probability.
 * The saturating curve expresses diminishing returns under the selected assumptions.
 * No confidence interval is invented and unrated accounts receive no fictional baseline.
 */
export function generateHorizonProjection(
  ratingHistory: CFRatingChange[],
  currentRatingParam?: number,
  params: PredictionParams = { dailyProblems: 2, difficultyOffset: 150, horizonMonths: 6 },
  referenceDate: Date = new Date()
): HorizonResult {
  const historical = historicalChartPoints(ratingHistory);
  const latest = historical[historical.length - 1]?.historicalRating;
  const currentRating = Number.isFinite(currentRatingParam) ? currentRatingParam! : latest ?? null;
  const dailyProblems = Math.max(1, Math.min(5, params.dailyProblems));
  const horizonDays = Math.max(30, Math.min(365, params.horizonMonths * 30));
  const totalProjectedProblems = horizonDays * dailyProblems;
  if (currentRating === null) {
    return { chartData: historical, milestones: [], currentRating: null, projectedRatingAtHorizon: null, totalProjectedProblems };
  }

  // These parameters are transparent scenario assumptions, not estimates learned from outcomes.
  const headroom = Math.max(100, 2800 - currentRating);
  const difficulty = 0.6 + Math.max(0, Math.min(300, params.difficultyOffset)) / 300;
  const ratingAtDay = (day: number) => currentRating + headroom * (1 - Math.exp(-day * dailyProblems * difficulty / 4500));
  const prediction: ChartDataPoint[] = [];
  for (let day = 0; day <= horizonDays; day += Math.max(1, Math.ceil(horizonDays / 40))) {
    const timestamp = referenceDate.getTime() + day * DAY;
    prediction.push({ timestamp, dateStr: new Date(timestamp).toISOString().slice(0, 10), predictedRating: Math.round(ratingAtDay(day)), isPrediction: true });
  }
  const endTimestamp = referenceDate.getTime() + horizonDays * DAY;
  if (prediction[prediction.length - 1]?.timestamp !== endTimestamp) {
    prediction.push({ timestamp: endTimestamp, dateStr: new Date(endTimestamp).toISOString().slice(0, 10), predictedRating: Math.round(ratingAtDay(horizonDays)), isPrediction: true });
  }
  const milestones = RANK_TIERS.filter(tier => tier.min >= 1200 && tier.min <= 3000).map(tier => {
    let crossing: number | null = null;
    if (currentRating < tier.min) {
      for (let day = 1; day <= horizonDays; day++) if (ratingAtDay(day) >= tier.min) { crossing = day; break; }
    }
    return {
      rankName: tier.name, threshold: tier.min, color: tier.color, achieved: currentRating >= tier.min,
      estimatedDate: crossing === null ? null : new Date(referenceDate.getTime() + crossing * DAY),
      daysRemaining: crossing, problemsRemaining: crossing === null ? null : crossing * dailyProblems,
    };
  });
  return { chartData: [...historical, ...prediction], milestones, currentRating, projectedRatingAtHorizon: Math.round(ratingAtDay(horizonDays)), totalProjectedProblems };
}
