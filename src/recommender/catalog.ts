import type { CFProblem, CFContest } from '../types/codeforces';
import type { EnrichedProblem } from './types';
import { problemKey } from './state';

export function enrichCatalog(problems: CFProblem[], contests: CFContest[]): EnrichedProblem[] {
  const contestMap = new Map(contests.map(c => [c.id, c]));
  return [...new Map(problems.filter(p => Number.isInteger(p.contestId) && p.contestId! > 0
    && /^[A-Za-z0-9_]+$/.test(p.index) && Number.isFinite(p.rating) && Array.isArray(p.tags))
    .map(p => [problemKey(p), p])).values()].flatMap(problem => {
    const contest = contestMap.get(problem.contestId!);
    if (problem.tags.includes('*special') || /april fools/i.test(contest?.name ?? '')
      || (contest && contest.phase !== 'FINISHED')) return [];
    return [{ ...problem, solvedCount: problem.solvedCount ?? 0, contestType: contest?.type,
      contestPhase: contest?.phase, contestStart: contest?.startTimeSeconds, qualityScore: 1 }];
  });
}
