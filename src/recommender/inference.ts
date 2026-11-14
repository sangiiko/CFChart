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

const EXPECTED_FEATURES_KEY = ACCEPTANCE_FEATURES.join('|');
const validatedModels = new WeakSet<AcceptanceModel>();

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

function validateModelStructure(model: AcceptanceModel): void {
  if (
    model.schemaVersion !== 1 ||
    model.target !== 'historical_acceptance' ||
    !Array.isArray(model.features) ||
    model.features.join('|') !== EXPECTED_FEATURES_KEY ||
    !model.validatedOffline ||
    model.deploymentAllowed ||
    !Array.isArray(model.trees) ||
    !model.trees.length ||
    !model.calibration ||
    !Number.isFinite(model.calibration.intercept) ||
    !Number.isFinite(model.calibration.slope) ||
    model.calibration.slope < 0
  ) {
    throw new Error('Invalid research acceptance model or features.');
  }
}

/** Predicts acceptance on a historical self-selected attempt, never independent solving. */
export function predictHistoricalAcceptanceModel(model: AcceptanceModel, values: readonly number[]): number {
  if (!validatedModels.has(model)) {
    validateModelStructure(model);
    if (
      Object.isFrozen(model) ||
      (model.trees.length > 10 && model.deploymentAllowed === false && model.validatedOffline === true)
    ) {
      validatedModels.add(model);
    }
  } else if (
    model.deploymentAllowed ||
    !model.validatedOffline ||
    model.schemaVersion !== 1 ||
    model.target !== 'historical_acceptance' ||
    !model.trees.length ||
    !Number.isFinite(model.calibration.intercept) ||
    !Number.isFinite(model.calibration.slope) ||
    model.calibration.slope < 0
  ) {
    throw new Error('Invalid research acceptance model or features.');
  }

  if (values.length !== ACCEPTANCE_FEATURES.length) {
    throw new Error('Invalid research acceptance model or features.');
  }
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v) && !Number.isNaN(v)) {
      throw new Error('Invalid research acceptance model or features.');
    }
  }

  let treeSum = 0;
  const trees = model.trees;
  for (let i = 0; i < trees.length; i++) {
    treeSum += evaluateAcceptanceTree(trees[i], values);
  }
  const raw = sigmoid(treeSum);
  const clipped = Math.max(1e-6, Math.min(1 - 1e-6, raw));
  return sigmoid(model.calibration.intercept + model.calibration.slope * Math.log(clipped / (1 - clipped)));
}
