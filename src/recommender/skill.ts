import type { SkillProfile } from './types';
import type { CFSubmission } from '../types/codeforces';

export function estimateSkill(_submissions: CFSubmission[], recentRating: number): SkillProfile {
  // Simple heuristic: blend rating with practice recent success
  // A proper Bayesian IRT would be better, but this is a solid start for v2
  const globalTheta = recentRating || 800;
  const tagTheta = new Map<string, number>();
  
  // TODO: Add actual Bayesian shrinkage based on activity
  return { globalTheta, tagTheta };
}

export function pSolve(skill: number, problemRating: number): number {
  // Logistic curve: P(solve) = 1 / (1 + 10^((rating - skill) / 400))
  const diff = problemRating - skill;
  return 1 / (1 + Math.pow(10, diff / 400));
}
