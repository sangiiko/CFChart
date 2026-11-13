import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateAcceptanceTree, predictHistoricalAcceptanceModel, type AcceptanceModel } from '../inference';
import { buildAcceptanceFeatures } from '../features';

describe('research acceptance inference', () => {
  it('respects numeric thresholds and missing directions', () => {
    const tree = { feature: 0, threshold: 0, defaultLeft: false,
      left: { leaf: -1 }, right: { leaf: 1 } };
    expect(evaluateAcceptanceTree(tree, [0])).toBe(-1);
    expect(evaluateAcceptanceTree(tree, [Number.NaN])).toBe(1);
  });

  it('requires research-only metadata and ordered features', () => {
    const model: AcceptanceModel = { schemaVersion: 1, target: 'historical_acceptance',
      features: ['relative_difficulty_400', 'rating_centered_1400_400', 'recent_attempts_90',
        'recent_solved_90', 'recent_tag_solved_90', 'days_since_attempt', 'problem_tag_count'],
      trees: [{ leaf: 0 }], calibration: { intercept: 0, slope: 1 },
      validatedOffline: true, deploymentAllowed: false };
    expect(predictHistoricalAcceptanceModel(model, [0, 0, 0, 0, 0, 0, 0])).toBeCloseTo(0.5, 12);
    expect(() => predictHistoricalAcceptanceModel({ ...model, deploymentAllowed: true }, [0, 0, 0, 0, 0, 0, 0])).toThrow();
    expect(() => predictHistoricalAcceptanceModel(model, [0])).toThrow();
  });

  const artifact = 'ml/artifacts/top10000-recommender-boosted/candidate.json';
  it.skipIf(!existsSync(artifact))('matches Python on the current trained artifact', () => {
    const model = JSON.parse(readFileSync(artifact, 'utf8')) as AcceptanceModel;
    const fixtures = [
      { x: [0, 0, 0, 0, 0, 3650, 2], p: 0.7744935740646743 },
      { x: [0.5, -0.5, 12, 8, 4, 2, 3], p: 0.8767138702119326 },
      { x: [-0.5, 1, 50, 30, 20, 0, 5], p: 0.9609647435426723 },
    ];
    for (const { x, p } of fixtures) expect(predictHistoricalAcceptanceModel(model, x)).toBeCloseTo(p, 10);
  });
});

it('builds candidate features from history available at decision time', () => {
  const day = 86400;
  const problem = { contestId: 200, index: 'B', name: 'New', rating: 1600, tags: ['dp', 'math'] };
  const submission = (id: number, at: number, verdict: string, tags: string[]) => ({
    id, creationTimeSeconds: at, verdict,
    problem: { contestId: id, index: 'A', name: 'Old', rating: 1500, tags },
  });
  const history = [submission(1, 91 * day, 'WRONG_ANSWER', ['dp']),
    submission(2, 99 * day, 'OK', ['dp']), submission(3, 100 * day, 'OK', ['math']),
    submission(4, 101 * day, 'OK', ['dp'])];
  const ratings = [{ contestId: 1, contestName: '', handle: 'alice', rank: 1,
    ratingUpdateTimeSeconds: 90 * day, oldRating: 1400, newRating: 1500 }];
  expect(buildAcceptanceFeatures(problem, history, ratings, 100 * day * 1000)).toEqual([
    0.25, 0.25, 3, 2, 2, 0, 2,
  ]);
  const priorTargetAttempt = { ...submission(5, 99 * day, 'WRONG_ANSWER', ['dp']), problem };
  expect(buildAcceptanceFeatures(problem, [...history, priorTargetAttempt], ratings, 100 * day * 1000)).toBeNull();
});
