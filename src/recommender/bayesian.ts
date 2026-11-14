/** Research-only anchored global ability + zero-sum topic deviations. */
export interface Belief {
  mean: number[];
  covariance: number[][];
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, x))));
const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);

function validate(b: Belief, x: number[]) {
  const n = x.length;
  if (
    !n ||
    b.mean.length !== n ||
    b.covariance.length !== n ||
    b.covariance.some(r => r.length !== n) ||
    [...x, ...b.mean, ...b.covariance.flat()].some(v => !Number.isFinite(v))
  )
    throw new Error('Invalid belief dimensions.');
}

/** k-1 contrasts encode k topic deviations whose sum is exactly zero. */
export function topicFeatures(weights: number[]): number[] {
  if (
    !weights.length ||
    weights.some(w => !Number.isFinite(w) || w < 0) ||
    Math.abs(weights.reduce((a, b) => a + b, 0) - 1) > 1e-9
  )
    throw new Error('Invalid topic weights.');
  return [1, ...weights.slice(0, -1).map(w => w - weights[weights.length - 1])];
}

export function updateBelief(b: Belief, x: number[], difficulty: number, outcome: 0 | 1): Belief {
  validate(b, x);
  if (!Number.isFinite(difficulty) || ![0, 1].includes(outcome)) throw new Error('Invalid observation.');
  const p = sigmoid(dot(x, b.mean) - difficulty),
    v = b.covariance.map(row => dot(row, x));
  const denominator = 1 + p * (1 - p) * dot(x, v);
  if (denominator < 1) throw new Error('Invalid covariance.');
  const covariance = b.covariance.map((row, i) => row.map((value, j) => value - (p * (1 - p) * v[i] * v[j]) / denominator));
  const mean = b.mean.map((value, i) => value + dot(covariance[i], x) * (outcome - p));
  return { mean, covariance };
}

/** Deterministic normal quantile integration of the projected latent variable. */
export function posteriorSolve(b: Belief, x: number[], difficulty: number): number {
  validate(b, x);
  if (!Number.isFinite(difficulty)) throw new Error('Invalid difficulty.');
  const variance = dot(
    x,
    b.covariance.map(row => dot(row, x))
  );
  if (variance < -1e-9) throw new Error('Invalid covariance.');
  const mean = dot(x, b.mean) - difficulty,
    sd = Math.sqrt(Math.max(0, variance));
  const nodes = [-1.644854, -1.036433, -0.67449, -0.38532, -0.125661, 0.125661, 0.38532, 0.67449, 1.036433, 1.644854];
  return nodes.reduce((sum, z) => sum + sigmoid(mean + sd * z), 0) / nodes.length;
}

/** Advance uncertainty over time: Sigma_pred = Sigma + Q * Delta_t. */
export function advanceUncertainty(b: Belief, qPerDay: number, elapsedDays: number): Belief {
  if (!Number.isFinite(qPerDay) || qPerDay < 0 || !Number.isFinite(elapsedDays) || elapsedDays < 0) {
    throw new Error('Invalid drift parameters.');
  }
  const drift = qPerDay * elapsedDays;
  const covariance = b.covariance.map((row, i) => row.map((val, j) => (i === j ? val + drift : val)));
  return { mean: [...b.mean], covariance };
}

/**
 * Expected Laplace-Gaussian log-determinant information gain I(theta; Y | x, difficulty):
 * measures how much attempting a task reduces epistemic skill uncertainty.
 */
export function expectedInformationGain(b: Belief, x: number[], difficulty: number): number {
  validate(b, x);
  if (!Number.isFinite(difficulty)) throw new Error('Invalid difficulty.');
  const v = b.covariance.map(row => dot(row, x));
  const projVar = dot(x, v);
  if (projVar < -1e-9) throw new Error('Invalid covariance.');
  const p = posteriorSolve(b, x, difficulty);
  const fisher = p * (1 - p);
  return 0.5 * Math.log(1 + Math.max(0, projVar) * fisher);
}

/** Upper Confidence Bound (UCB) acquisition score in projected ability space. */
export function ucbScore(b: Belief, x: number[], difficulty: number, beta = 1.0): number {
  validate(b, x);
  if (!Number.isFinite(difficulty) || !Number.isFinite(beta) || beta < 0) {
    throw new Error('Invalid UCB parameters.');
  }
  const v = b.covariance.map(row => dot(row, x));
  const projVar = dot(x, v);
  if (projVar < -1e-9) throw new Error('Invalid covariance.');
  const meanMargin = dot(x, b.mean) - difficulty;
  return sigmoid(meanMargin) + beta * Math.sqrt(Math.max(0, projVar));
}
