import type { CFSubmission, HabitProgress, SolvedProblemSummary, HabitDaySummary } from '../types/codeforces';
import type { HistoryCoverage } from '../types/app';
import type { PracticeEvent } from '../recommender/types';
import { getProblemKey, getProblemUrl } from './codeforcesApi';
import { format, subDays } from 'date-fns';

/** A day follows the browser's local timezone. Count distinct accepted tasks per day. */
export function calculateHabitProgress(
  submissions: CFSubmission[],
  dailyTarget = 2,
  referenceDate = new Date(),
  coverage: HistoryCoverage = { complete: true, loaded: submissions.length },
  events: PracticeEvent[] = [],
): HabitProgress {
  dailyTarget = Number.isFinite(dailyTarget) ? Math.max(1, Math.floor(dailyTarget)) : 2;
  const solvedByDate = new Map<string, Map<string, SolvedProblemSummary>>();
  const cutoffDate = coverage.earliestTime === undefined ? undefined : format(new Date(coverage.earliestTime * 1000), 'yyyy-MM-dd');
  const isUnknownDay = (day: string) => !coverage.complete && (!cutoffDate || day <= cutoffDate);

  for (const sub of submissions) {
    if (sub.verdict !== 'OK' || sub.creationTimeSeconds * 1000 > referenceDate.getTime()) continue;
    const key = getProblemKey(sub.problem.contestId, sub.problem.index);
    // Unidentified tasks cannot safely be deduplicated by their human-readable names.
    if (!key) continue;
    const dateStr = format(new Date(sub.creationTimeSeconds * 1000), 'yyyy-MM-dd');
    if (!solvedByDate.has(dateStr)) solvedByDate.set(dateStr, new Map());
    const dayMap = solvedByDate.get(dateStr)!;
    const previous = dayMap.get(key);
    if (!previous || previous.timestamp > sub.creationTimeSeconds * 1000) {
      dayMap.set(key, {
        key, name: sub.problem.name, contestId: sub.problem.contestId, index: sub.problem.index,
        rating: sub.problem.rating, timestamp: sub.creationTimeSeconds * 1000,
        url: getProblemUrl(sub.problem.contestId, sub.problem.index),
      });
    }
  }

  for (const event of events) {
    if (event.timestamp > referenceDate.getTime()) continue;
    if (!['accepted', 'independent', 'assisted'].includes(event.outcome)) continue;
    const dateStr = format(new Date(event.timestamp), 'yyyy-MM-dd');
    if (!solvedByDate.has(dateStr)) solvedByDate.set(dateStr, new Map());
    const dayMap = solvedByDate.get(dateStr)!;
    const previous = dayMap.get(event.problemKey);
    if (!previous) {
      dayMap.set(event.problemKey, {
        key: event.problemKey,
        name: event.problem?.name ?? event.problemKey,
        contestId: event.problem?.contestId,
        index: event.problem?.index ?? '',
        rating: event.problem?.rating,
        timestamp: event.timestamp,
        url: event.problem?.url ?? getProblemUrl(event.problem?.contestId, event.problem?.index ?? ''),
      });
    }
  }

  const todayStr = format(referenceDate, 'yyyy-MM-dd');
  const todayProblems = [...(solvedByDate.get(todayStr)?.values() ?? [])].sort((a, b) => b.timestamp - a.timestamp);
  const todayCount = todayProblems.length;
  const isTodayTargetMet = todayCount >= dailyTarget;
  let currentStreak = 0;
  let cursor = isTodayTargetMet ? referenceDate : subDays(referenceDate, 1);
  // Each successful iteration consumes one populated date, so this is naturally bounded.
  while ((solvedByDate.get(format(cursor, 'yyyy-MM-dd'))?.size ?? 0) >= dailyTarget) {
    currentStreak++;
    cursor = subDays(cursor, 1);
  }

  const recentDays: HabitDaySummary[] = Array.from({ length: 30 }, (_, index) => {
    const dateStr = format(subDays(referenceDate, 29 - index), 'yyyy-MM-dd');
    const solvedCount = solvedByDate.get(dateStr)?.size ?? 0;
    return { dateStr, solvedCount, targetMet: solvedCount >= dailyTarget, unknown: isUnknownDay(dateStr) };
  });

  return {
    dailyTarget, todayCount, isTodayTargetMet, todayProblems, currentStreak, recentDays,
    lastUpdated: referenceDate.getTime(), historyComplete: coverage.complete,
    unknownBeforeDate: coverage.complete ? undefined : cutoffDate,
    streakIsLowerBound: isUnknownDay(format(cursor, 'yyyy-MM-dd')),
  };
}
