import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFeatures, FEATURE_NAMES, type ForecastSnapshot } from '../features';
import { evaluateTree, getForecast, predictQuantiles, type ForecastModel } from '../inference';

const asOf = 1767225600;
const snapshot: ForecastSnapshot = {
  ratings: [0, 1, 2].map(i => ({ contestId: i, contestName: `Round ${i}`, handle: 'fixture', rank: 1,
    oldRating: 900 + i * 100, newRating: 1000 + i * 100, ratingUpdateTimeSeconds: asOf - (3 - i) * 86400 })),
  submissions: [], coverage: { complete: true },
};

const testModel: ForecastModel = {
  schemaVersion: 1, version: 'synthetic-unit-test-only', featureNames: [...FEATURE_NAMES],
  validated: true, trainedAt: '2026-01-01T00:00:00Z', minimumContests: 3, minimumHistoryDays: 90,
  gate: { temporalPassed: true, usersPassed: true, parityPassed: true, runtimeParityPassed: true, retrospectiveMetadata: true },
  models: ([30, 90] as const).flatMap(horizonDays => ([0.1, 0.5, 0.9] as const).map((quantile, i) => ({
    horizonDays, quantile, trees: [{ leaf: 900 + i * 100 }],
  }))),
};

describe('ML forecast adapter', () => {
  it('rejects absent/unvalidated models and insufficient history instead of fabricating predictions', () => {
    expect(getForecast(snapshot).available).toBe(false);
    expect(getForecast(snapshot, new Date(asOf * 1000), { ...testModel, validated: false }).available).toBe(false);
    expect(getForecast({ ...snapshot, coverage: {} }, new Date(asOf * 1000), testModel).available).toBe(false);
    expect(getForecast({ ...snapshot, ratings: [] }, new Date(asOf * 1000), testModel).available).toBe(false);
    expect(getForecast({ ...snapshot, coverage: { complete: true, fetchedAt: (asOf - 86401) * 1000 } },
      new Date(asOf * 1000), testModel).available).toBe(false);
    expect(getForecast(snapshot, new Date(asOf * 1000), { ...testModel, ratingRange: [1500, 2000] }).available).toBe(false);
  });

  it('keeps declines and independent horizon values', () => {
    const result = getForecast(snapshot, new Date(asOf * 1000), testModel);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.forecasts.map(f => f.horizonDays)).toEqual([30, 90]);
      expect(result.forecasts[0].median).toBe(1000);
      expect(result.forecasts[0].median).toBeLessThan(1200);
    }
  });

  it('never leaks future contest results into as-of features', () => {
    const before = buildFeatures(snapshot, new Date(asOf * 1000));
    const future = { ...snapshot, ratings: [...snapshot.ratings,
      { ...snapshot.ratings[0], newRating: 4000, ratingUpdateTimeSeconds: asOf + 1 }] };
    expect(buildFeatures(future, new Date(asOf * 1000)).values).toEqual(before.values);
    expect(before.values.length).toBe(FEATURE_NAMES.length);
    expect(before.values[1]).toBe(1200);
  });

  it('uses UTC windows, deduplicates accepted tasks, and exposes difficulty and practice signals', () => {
    const sub = { id: 1, creationTimeSeconds: asOf - 1, verdict: 'OK',
      author: { participantType: 'PRACTICE' }, problem: { contestId: 1, index: 'A', name: 'Task', rating: 1300, tags: ['math'] } };
    const features = buildFeatures({ ...snapshot, submissions: [sub, { ...sub, id: 2 }] }, new Date(asOf * 1000));
    const get = (name: string) => features.values[FEATURE_NAMES.indexOf(name)];
    expect(get('attempts_7')).toBe(2);
    expect(get('unique_accepted_7')).toBe(1);
    expect(get('mean_relative_difficulty_7')).toBe(100);
    expect(get('active_days_7')).toBe(1);
  });

  it('matches numeric tree split boundaries and missing routing', () => {
    const tree = { feature: 0, threshold: 2, defaultLeft: true, left: { leaf: -3 }, right: { leaf: 7 } };
    expect(evaluateTree(tree, [2])).toBe(-3);
    expect(evaluateTree(tree, [2.001])).toBe(7);
    expect(evaluateTree(tree, [NaN])).toBe(-3);
  });
});

// The offline trainer creates this fixture from native LightGBM outputs and
// invokes this same test before marking an export eligible for installation.
if (process.env.CFCHART_PARITY_FIXTURE) {
  const fixture = JSON.parse(readFileSync(process.env.CFCHART_PARITY_FIXTURE, 'utf8')) as {
    model: ForecastModel;
    samples: Array<{ snapshot: ForecastSnapshot; asOf: number; features: number[];
      predictions: Array<{ horizonDays: number; quantile: number; value: number }> }>;
  };
  describe('native Python → shipped TypeScript parity', () => {
    for (const [index, sample] of fixture.samples.entries()) {
      it(`matches native preprocessing and all six forecasts for sample ${index}`, () => {
        const features = buildFeatures(sample.snapshot, new Date(sample.asOf * 1000));
        expect(features.values.length).toBe(sample.features.length);
        features.values.forEach((value, i) => expect(value).toBeCloseTo(sample.features[i], 9));
        const predictions = predictQuantiles(fixture.model, features.values);
        predictions.forEach((prediction, i) => {
          expect(prediction.horizonDays).toBe(sample.predictions[i].horizonDays);
          expect(prediction.quantile).toBe(sample.predictions[i].quantile);
          expect(prediction.value).toBeCloseTo(sample.predictions[i].value, 7);
        });
      });
    }
  });
}
