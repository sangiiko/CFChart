/** Browser evaluator for the research-only historical acceptance model. */
export const ACCEPTANCE_FEATURES = [
  'relative_difficulty_400', 'rating_centered_1400_400',
  'recent_attempts_90', 'recent_solved_90', 'recent_tag_solved_90',
  'days_since_attempt', 'problem_tag_count',
] as const;

export type AcceptanceTree = { leaf: number } | {
  feature: number;
  threshold: number;
  defaultLeft: boolean;
  left: AcceptanceTree;
  right: AcceptanceTree;
};

export interface AcceptanceModel {
  schemaVersion: 1;
  target: 'historical_acceptance';
  features: string[];
  trees: AcceptanceTree[];
  calibration: { intercept: number; slope: number };
  validatedOffline: boolean;
  deploymentAllowed: boolean;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));
}

/** Exact numeric <= tree traversal, including LightGBM's missing-value direction. */
export function evaluateAcceptanceTree(tree: AcceptanceTree, values: readonly number[]): number {
  let node = tree;
  while (!('leaf' in node)) {
    if (!Number.isInteger(node.feature) || node.feature < 0 || node.feature >= values.length ||
      !Number.isFinite(node.threshold)) throw new Error('Invalid acceptance tree.');
    const value = values[node.feature];
    node = (Number.isNaN(value) ? node.defaultLeft : value <= node.threshold) ? node.left : node.right;
  }
  if (!Number.isFinite(node.leaf)) throw new Error('Invalid acceptance leaf.');
  return node.leaf;
}

/** Predicts acceptance on a historical self-selected attempt, never independent solving. */
export function predictHistoricalAcceptanceModel(model: AcceptanceModel, values: readonly number[]): number {
  if (model.schemaVersion !== 1 || model.target !== 'historical_acceptance' ||
    model.features.join('|') !== ACCEPTANCE_FEATURES.join('|') || !model.validatedOffline ||
    model.deploymentAllowed || !model.trees.length || values.length !== ACCEPTANCE_FEATURES.length ||
    values.some(value => !Number.isFinite(value) && !Number.isNaN(value)) ||
    !Number.isFinite(model.calibration.intercept) || !Number.isFinite(model.calibration.slope) ||
    model.calibration.slope < 0) throw new Error('Invalid research acceptance model or features.');
  const raw = sigmoid(model.trees.reduce((sum, tree) => sum + evaluateAcceptanceTree(tree, values), 0));
  const clipped = Math.max(1e-6, Math.min(1 - 1e-6, raw));
  return sigmoid(model.calibration.intercept + model.calibration.slope * Math.log(clipped / (1 - clipped)));
}
