import { buildFeatures, FEATURE_NAMES, type ForecastSnapshot } from './features';

export type ForecastTree = { leaf: number } | {
  feature: number;
  threshold: number;
  defaultLeft: boolean;
  left: ForecastTree;
  right: ForecastTree;
};

export interface ForecastModel {
  schemaVersion: 1;
  version: string;
  featureNames: string[];
  validated: boolean;
  trainedAt: string;
  minimumContests: number;
  minimumHistoryDays: number;
  ratingRange?: [number, number];
  // LightGBM dump leaf values already include shrinkage and initial score.
  models: Array<{ horizonDays: 30 | 90; quantile: 0.1 | 0.5 | 0.9; trees: ForecastTree[] }>;
  gate: { temporalPassed: boolean; usersPassed: boolean; parityPassed: boolean; runtimeParityPassed: boolean; retrospectiveMetadata: boolean };
}

export type ForecastResult = { available: false; reason: string } | {
  available: true;
  version: string;
  asOf: number;
  forecasts: Array<{ horizonDays: 30 | 90; timestamp: number; lower: number; median: number; upper: number }>;
};

export function evaluateTree(tree: ForecastTree, values: readonly number[]): number {
  let node = tree;
  while (!('leaf' in node)) {
    const value = values[node.feature];
    node = (Number.isNaN(value) ? node.defaultLeft : value <= node.threshold) ? node.left : node.right;
  }
  return node.leaf;
}

export function predictQuantiles(model: ForecastModel, values: readonly number[]) {
  if (values.length !== FEATURE_NAMES.length || values.some(v => !Number.isFinite(v))) {
    throw new Error('Invalid forecast feature vector');
  }
  return model.models.map(m => ({
    horizonDays: m.horizonDays,
    quantile: m.quantile,
    value: m.trees.reduce((sum, tree) => sum + evaluateTree(tree, values), 0),
  }));
}

export function getForecast(
  snapshot: ForecastSnapshot,
  referenceDate = new Date(),
  model: ForecastModel | null = null,
): ForecastResult {
  if (!model) return { available: false, reason: 'ML forecast unavailable: no validated model is installed.' };
  if (!model.validated || !model.gate.temporalPassed || !model.gate.usersPassed || !model.gate.parityPassed || !model.gate.runtimeParityPassed) {
    return { available: false, reason: 'ML forecast unavailable: this model has not passed evaluation.' };
  }
  if (model.schemaVersion !== 1 || model.featureNames.join('|') !== FEATURE_NAMES.join('|')) {
    return { available: false, reason: 'ML forecast unavailable: incompatible model features.' };
  }
  const fetchedAt = snapshot.coverage?.fetchedAt;
  if (fetchedAt !== undefined && referenceDate.getTime() - fetchedAt > 86400000) {
    return { available: false, reason: 'Refresh the submission history before generating a forecast.' };
  }
  const features = buildFeatures(snapshot, referenceDate);
  if (features.contestCount < model.minimumContests) {
    return { available: false, reason: `More rated history is needed (at least ${model.minimumContests} contests).` };
  }
  if (features.historyDays < model.minimumHistoryDays) {
    return { available: false, reason: `Submission history is still syncing (${model.minimumHistoryDays} days needed).` };
  }
  if (model.ratingRange && (features.values[0] < model.ratingRange[0] || features.values[0] > model.ratingRange[1])) {
    return { available: false, reason: 'This rating is outside the model’s training range.' };
  }
  const predictions = predictQuantiles(model, features.values);
  const forecasts = ([30, 90] as const).map(horizonDays => {
    const group = predictions.filter(p => p.horizonDays === horizonDays).sort((a, b) => a.quantile - b.quantile);
    if (group.length !== 3 || group.map(p => p.quantile).join(',') !== '0.1,0.5,0.9') {
      throw new Error('Incomplete forecast model');
    }
    // Independent quantile models can cross. Use the same order correction in evaluation.
    const sorted = group.map(p => p.value).sort((a, b) => a - b);
    return { horizonDays, timestamp: referenceDate.getTime() + horizonDays * 86400000,
      lower: Math.round(sorted[0]), median: Math.round(sorted[1]), upper: Math.round(sorted[2]) };
  });
  return { available: true, version: model.version, asOf: referenceDate.getTime(), forecasts };
}
