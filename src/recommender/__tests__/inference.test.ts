import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateAcceptanceTree, predictHistoricalAcceptanceModel, type AcceptanceModel } from '../inference';
import { buildAcceptanceFeatures, buildAcceptanceFeaturesFromHistory, prepareAcceptanceHistory } from '../features';
import { enrichCatalog } from '../catalog';
import { buildPracticeState } from '../state';
import { selectRecommendationsV2 } from '..';
import modelJson from '../acceptance-model.json';

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

  it('matches Python episode-level parity across boundary, duplicate, and censored cases', () => {
    const model = modelJson as AcceptanceModel;
    const day = 86400;
    const asOfMs = 200 * day * 1000;
    const ratings = [
      { contestId: 1, contestName: 'R1', handle: 'u', rank: 100, ratingUpdateTimeSeconds: 50 * day, oldRating: 1200, newRating: 1400 },
      { contestId: 2, contestName: 'R2', handle: 'u', rank: 50, ratingUpdateTimeSeconds: 180 * day, oldRating: 1400, newRating: 1600 },
      { contestId: 3, contestName: 'R3', handle: 'u', rank: 10, ratingUpdateTimeSeconds: 210 * day, oldRating: 1600, newRating: 1900 },
    ];
    const submissions = [
      { id: 1, creationTimeSeconds: 109 * day, verdict: 'OK', problem: { contestId: 10, index: 'A', name: 'Old', rating: 1400, tags: ['dp'] } },
      { id: 2, creationTimeSeconds: 110 * day, verdict: 'OK', problem: { contestId: 11, index: 'A', name: 'Boundary', rating: 1500, tags: ['dp', 'graphs'] } },
      { id: 2, creationTimeSeconds: 110 * day, verdict: 'OK', problem: { contestId: 11, index: 'A', name: 'Boundary', rating: 1500, tags: ['dp', 'graphs'] } },
      { id: 3, creationTimeSeconds: 150 * day, verdict: 'WRONG_ANSWER', problem: { contestId: 12, index: 'B', name: 'Multi', rating: 1600, tags: ['trees', 'dfs and similar'] } },
      { id: 4, creationTimeSeconds: 151 * day, verdict: 'OK', problem: { contestId: 12, index: 'B', name: 'Multi', rating: 1600, tags: ['trees', 'dfs and similar'] } },
      { id: 5, creationTimeSeconds: 195 * day, verdict: 'WRONG_ANSWER', problem: { contestId: 13, index: 'C', name: 'Censored', rating: 1700, tags: ['dp', 'trees'] } },
      { id: 6, creationTimeSeconds: 205 * day, verdict: 'OK', problem: { contestId: 13, index: 'C', name: 'Censored', rating: 1700, tags: ['dp', 'trees'] } },
    ];
    const cases = [
      {
        candidate: { contestId: 99, index: 'A', name: 'Cand1', rating: 1600, tags: ['dp', 'graphs', 'trees'] },
        expectedFeatures: [0.0, 0.5, 3, 2, 2, 5.0, 3],
        expectedProb: 0.8657825564820225,
      },
      {
        candidate: { contestId: 99, index: 'B', name: 'Cand2', rating: 1800, tags: ['math'] },
        expectedFeatures: [0.5, 0.5, 3, 2, 0, 5.0, 1],
        expectedProb: 0.8143085044899363,
      },
      {
        candidate: { contestId: 99, index: 'C', name: 'Cand3', rating: 1500, tags: [] },
        expectedFeatures: [-0.25, 0.5, 3, 2, 0, 5.0, 0],
        expectedProb: 0.8426447284402806,
      },
    ];

    const history = prepareAcceptanceHistory(submissions, ratings, asOfMs);
    for (const c of cases) {
      const features = buildAcceptanceFeaturesFromHistory(c.candidate, history);
      expect(features).toEqual(c.expectedFeatures);
      expect(predictHistoricalAcceptanceModel(model, features!)).toBeCloseTo(c.expectedProb, 12);
    }
  });

  it('ranks 500 candidates with shadow tree inference well within the 150ms latency budget', () => {
    const day = 86400;
    const nowMs = 200 * day * 1000;
    const ratings = [
      { contestId: 1, contestName: 'R1', handle: 'u', rank: 10, ratingUpdateTimeSeconds: 180 * day, oldRating: 1500, newRating: 1600 },
    ];
    const submissions = Array.from({ length: 40 }, (_, i) => ({
      id: i + 1,
      creationTimeSeconds: (150 + i) * day,
      verdict: i % 3 === 0 ? 'WRONG_ANSWER' : 'OK',
      problem: { contestId: i + 1, index: 'A', name: `Solved ${i}`, rating: 1500 + (i % 5) * 100, tags: ['dp', 'graphs'] },
    }));
    const rawProblems = Array.from({ length: 500 }, (_, i) => ({
      contestId: 1000 + i,
      index: 'B',
      name: `Candidate ${i}`,
      rating: 1450 + (i % 9) * 50,
      tags: i % 2 === 0 ? ['dp', 'math'] : ['trees', 'greedy'],
      solvedCount: 1500 + i * 10,
    }));
    const enriched = enrichCatalog(rawProblems, []);
    const state = buildPracticeState(submissions, ratings, 1600, true, [], nowMs);

    // Warm run
    selectRecommendationsV2(enriched, state, 4, 120);
    const start = performance.now();
    const recommendations = selectRecommendationsV2(enriched, state, 4, 120);
    const elapsedMs = performance.now() - start;

    expect(recommendations.length).toBe(4);
    expect(recommendations.every(r => typeof r.shadowAcceptance === 'number')).toBe(true);
    expect(elapsedMs).toBeLessThan(150);
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
