import { EnrichedProblem } from './types';

export function scoreProblem(
  problem: EnrichedProblem,
  skill: number,
  isSolved: boolean,
  isWeakTag: boolean
): number {
  if (isSolved) return 0;

  const prob = 1 / (1 + Math.pow(10, (problem.rating! - skill) / 400));
  
  // Target 50-65% solve probability
  const fit = prob > 0.4 && prob < 0.7 ? 1.5 : 1.0;
  
  let score = fit * problem.qualityScore;
  if (isWeakTag) score *= 1.3;
  
  return score;
}
