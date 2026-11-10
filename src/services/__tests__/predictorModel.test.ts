import { describe, it, expect } from 'vitest';
import { generateHorizonProjection, historicalChartPoints } from '../predictorModel';
import { CFRatingChange } from '../../types/codeforces';
const today = new Date('2026-11-10T12:00:00Z');
const history: CFRatingChange[] = [
  { contestId: 1, contestName: 'Round #1', handle: 'test', rank: 500, ratingUpdateTimeSeconds: 1700000000, oldRating: 0, newRating: 1250 },
  { contestId: 2, contestName: 'Round #2', handle: 'test', rank: 300, ratingUpdateTimeSeconds: 1705000000, oldRating: 1250, newRating: 1380 },
];
describe('illustrative practice scenario', () => {
  it('keeps every real contest and anchors the separate scenario today', () => {
    const result = generateHorizonProjection(history, 1380, { dailyProblems: 2, difficultyOffset: 150, horizonMonths: 6 }, today);
    const past = result.chartData.filter(point => !point.isPrediction);
    expect(past.map(point => point.historicalRating)).toEqual([1250, 1380]);
    expect(past[1].timestamp).toBe(1705000000000);
    const future = result.chartData.filter(point => point.isPrediction);
    expect(future[0].timestamp).toBe(today.getTime()); expect(future[0].predictedRating).toBe(1380);
    expect(result.projectedRatingAtHorizon).toBeGreaterThan(1380);
    expect(future.every(point => point.lowerBound === undefined && point.upperBound === undefined)).toBe(true);
  });
  it('does not invent an unrated baseline or prediction', () => {
    const result = generateHorizonProjection([], undefined, undefined, today);
    expect(result.currentRating).toBeNull(); expect(result.projectedRatingAtHorizon).toBeNull(); expect(result.chartData).toEqual([]);
  });
  it('keeps zero and very high official ratings without a fallback', () => {
    expect(generateHorizonProjection([], 0, undefined, today).currentRating).toBe(0);
    expect(generateHorizonProjection([], 4000, undefined, today).currentRating).toBe(4000);
  });
  it('uses historical timestamps and ratings unchanged after sorting', () => {
    const points = historicalChartPoints([...history].reverse());
    expect(points.map(point => point.timestamp)).toEqual([1700000000000, 1705000000000]);
    expect(points.map(point => point.historicalRating)).toEqual([1250, 1380]);
  });
});
