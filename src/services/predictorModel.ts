import { CFRatingChange, PredictionParams, ChartDataPoint, MilestoneTarget } from '../types/codeforces';
import { RANK_TIERS, getRankTier } from './codeforcesApi';
import { format, addDays, fromUnixTime } from 'date-fns';

export interface HorizonResult {
  chartData: ChartDataPoint[];
  milestones: MilestoneTarget[];
  currentRating: number;
  projectedRatingAtHorizon: number;
  totalProjectedProblems: number;
}

export function generateHorizonProjection(
  ratingHistory: CFRatingChange[],
  currentRatingParam?: number,
  params: PredictionParams = { dailyProblems: 2, difficultyOffset: 150, horizonMonths: 6 },
  referenceDate: Date = new Date()
): HorizonResult {
  const { dailyProblems = 2, difficultyOffset = 150, horizonMonths = 6 } = params;
  const horizonDays = Math.max(30, horizonMonths * 30);

  // 1. Process historical points
  const historicalPoints: ChartDataPoint[] = [];

  if (ratingHistory && ratingHistory.length > 0) {
    // Sort chronologically
    const sortedHistory = [...ratingHistory].sort(
      (a, b) => a.ratingUpdateTimeSeconds - b.ratingUpdateTimeSeconds
    );

    for (const item of sortedHistory) {
      const d = fromUnixTime(item.ratingUpdateTimeSeconds);
      const tier = getRankTier(item.newRating);
      historicalPoints.push({
        dateStr: format(d, 'yyyy-MM-dd'),
        timestamp: item.ratingUpdateTimeSeconds * 1000,
        historicalRating: item.newRating,
        contestName: item.contestName,
        rank: item.rank,
        rankColor: tier.color,
        isPrediction: false,
      });
    }
  }

  // Determine current active rating
  let currentRating = currentRatingParam ?? 1200;
  if (!currentRatingParam && historicalPoints.length > 0) {
    currentRating = historicalPoints[historicalPoints.length - 1].historicalRating || 1200;
  }
  if (currentRating <= 0) currentRating = 1000;

  // Anchor point: today
  const anchorTimestamp = referenceDate.getTime();
  const anchorDateStr = format(referenceDate, 'yyyy-MM-dd');

  // If no history exists, create an initial anchor point
  if (historicalPoints.length === 0) {
    historicalPoints.push({
      dateStr: anchorDateStr,
      timestamp: anchorTimestamp,
      historicalRating: currentRating,
      contestName: 'Current Baseline',
      rankColor: getRankTier(currentRating).color,
      isPrediction: false,
    });
  }

  // 2. Generate Future Projection
  const predictionPoints: ChartDataPoint[] = [];
  
  // Anchor prediction starting from the exact current rating
  predictionPoints.push({
    dateStr: anchorDateStr,
    timestamp: anchorTimestamp,
    historicalRating: currentRating,
    predictedRating: currentRating,
    lowerBound: currentRating,
    upperBound: currentRating,
    isPrediction: true,
  });

  let simulatedRating = currentRating;
  const sampleInterval = Math.max(2, Math.floor(horizonDays / 30)); // sample ~30 points for smooth charting

  // Track milestones
  const milestoneMap = new Map<number, { day: number; date: Date }>();
  const activeTiers = RANK_TIERS.filter(t => t.min > 0);

  for (let day = 1; day <= horizonDays; day++) {
    // Diminishing returns elasticity:
    // It takes substantially more practice to gain rating at 2200 than at 1200.
    const elasticity = Math.max(0.12, (2600 - simulatedRating) / 1600);
    
    // Difficulty factor: practicing harder problems accelerates growth
    const difficultyFactor = 0.5 + Math.min(1.5, Math.max(0.2, difficultyOffset / 200));

    // Daily expected delta
    const dailyDelta = dailyProblems * 0.42 * difficultyFactor * elasticity;
    simulatedRating += dailyDelta;

    // Check tier crossing
    for (const tier of activeTiers) {
      if (currentRating < tier.min && simulatedRating >= tier.min && !milestoneMap.has(tier.min)) {
        milestoneMap.set(tier.min, {
          day,
          date: addDays(referenceDate, day),
        });
      }
    }

    // Sample points for the chart
    if (day % sampleInterval === 0 || day === horizonDays) {
      const pDate = addDays(referenceDate, day);
      
      // Uncertainty cone spreads out over time: stdDev ~ sqrt(day)
      const uncertainty = Math.min(220, Math.sqrt(day) * 5.5);
      const roundedPred = Math.round(simulatedRating);

      predictionPoints.push({
        dateStr: format(pDate, 'yyyy-MM-dd'),
        timestamp: pDate.getTime(),
        predictedRating: roundedPred,
        lowerBound: Math.round(Math.max(simulatedRating - uncertainty * 0.85, currentRating * 0.9)),
        upperBound: Math.round(simulatedRating + uncertainty * 1.15),
        isPrediction: true,
      });
    }
  }

  // 3. Assemble Milestones
  const milestones: MilestoneTarget[] = activeTiers
    .filter(t => t.min >= 1200 && t.min <= 2600)
    .map(tier => {
      const achieved = currentRating >= tier.min;
      const hit = milestoneMap.get(tier.min);

      return {
        rankName: tier.name,
        threshold: tier.min,
        color: tier.color,
        achieved,
        estimatedDate: hit ? hit.date : null,
        daysRemaining: hit ? hit.day : null,
        problemsRemaining: hit ? hit.day * dailyProblems : null,
      };
    });

  // Combine historical and future data
  // Avoid duplicate anchor point in the merged list
  const chartData: ChartDataPoint[] = [
    ...historicalPoints.slice(0, -1),
    ...predictionPoints
  ];

  return {
    chartData,
    milestones,
    currentRating,
    projectedRatingAtHorizon: Math.round(simulatedRating),
    totalProjectedProblems: horizonDays * dailyProblems,
  };
}
