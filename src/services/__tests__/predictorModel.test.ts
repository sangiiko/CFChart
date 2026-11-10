import { describe, it, expect } from 'vitest';
import { generateHorizonProjection } from '../predictorModel';
import { CFRatingChange } from '../../types/codeforces';

describe('predictorModel', () => {
  it('generates consistent projection starting from current rating', () => {
    const today = new Date('2026-11-10T12:00:00Z');
    const history: CFRatingChange[] = [
      { contestId: 1, contestName: 'Round #1', handle: 'test', rank: 500, ratingUpdateTimeSeconds: 1700000000, oldRating: 0, newRating: 1250 },
      { contestId: 2, contestName: 'Round #2', handle: 'test', rank: 300, ratingUpdateTimeSeconds: 1705000000, oldRating: 1250, newRating: 1380 },
    ];

    const result = generateHorizonProjection(
      history,
      1380,
      { dailyProblems: 2, difficultyOffset: 150, horizonMonths: 6 },
      today
    );

    expect(result.currentRating).toBe(1380);
    expect(result.chartData.length).toBeGreaterThan(5);
    expect(result.projectedRatingAtHorizon).toBeGreaterThan(1380);
    expect(result.totalProjectedProblems).toBe(180 * 2);

    // Verify first prediction point anchors at current rating
    const predictionPoints = result.chartData.filter(p => p.isPrediction);
    expect(predictionPoints[0].predictedRating).toBe(1380);

    // Verify Specialist milestone (1400) is recognized
    const specialistMilestone = result.milestones.find(m => m.threshold === 1400);
    expect(specialistMilestone).toBeDefined();
    expect(specialistMilestone?.achieved).toBe(false);
    expect(specialistMilestone?.daysRemaining).toBeGreaterThan(0);
    expect(specialistMilestone?.problemsRemaining).toBeGreaterThan(0);
  });

  it('handles unrated baseline gracefully', () => {
    const result = generateHorizonProjection([], undefined, { dailyProblems: 2, difficultyOffset: 150, horizonMonths: 3 });
    expect(result.currentRating).toBe(1200);
    expect(result.projectedRatingAtHorizon).toBeGreaterThan(1200);
  });
});
