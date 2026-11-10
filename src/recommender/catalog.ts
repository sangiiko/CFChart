import type { CFProblem, CFContest } from '../types/codeforces';
import { EnrichedProblem } from './types';

export function enrichCatalog(problems: CFProblem[], contests: CFContest[]): EnrichedProblem[] {
  const contestMap = new Map(contests.map(c => [c.id, c]));
  
  return problems.map(problem => {
    const contest = problem.contestId ? contestMap.get(problem.contestId) : undefined;
    const isModern = (contest?.startTimeSeconds ?? 0) > 1451606400; // 2016-01-01
    
    // Quality scoring
    let qualityScore = 1.0;
    
    // Filter out known junk/special
    if (problem.tags.includes('*special') || 
        contest?.name.toLowerCase().includes('april fools') ||
        contest?.name.toLowerCase().includes('kotlin')) {
      qualityScore *= 0.1;
    }

    // Boost modern rounds
    if (isModern) qualityScore *= 1.2;

    return {
      ...problem,
      solvedCount: problem.solvedCount ?? 0,
      contestType: contest?.type,
      contestPhase: contest?.phase,
      isModern,
      qualityScore
    };
  }).filter(p => p.qualityScore > 0.5);
}
