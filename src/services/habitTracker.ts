import { CFSubmission, HabitProgress, SolvedProblemSummary, HabitDaySummary } from '../types/codeforces';
import { getProblemKey, getProblemUrl } from './codeforcesApi';
import { format, subDays } from 'date-fns';

export function calculateHabitProgress(
  submissions: CFSubmission[],
  dailyTarget: number = 2,
  referenceDate: Date = new Date()
): HabitProgress {
  // Map of date string 'YYYY-MM-DD' -> Map of problemKey -> SolvedProblemSummary
  const solvedByDate = new Map<string, Map<string, SolvedProblemSummary>>();
  const allSolvedKeys = new Set<string>();

  // Filter only OK submissions
  const acceptedSubmissions = submissions.filter(sub => sub.verdict === 'OK');

  for (const sub of acceptedSubmissions) {
    const subDate = new Date(sub.creationTimeSeconds * 1000);
    const dateStr = format(subDate, 'yyyy-MM-dd');
    const key = getProblemKey(sub.problem.contestId, sub.problem.index) || `${sub.problem.name}`;

    allSolvedKeys.add(key);

    if (!solvedByDate.has(dateStr)) {
      solvedByDate.set(dateStr, new Map());
    }

    const dayMap = solvedByDate.get(dateStr)!;
    if (!dayMap.has(key)) {
      dayMap.set(key, {
        key,
        name: sub.problem.name,
        contestId: sub.problem.contestId,
        index: sub.problem.index,
        rating: sub.problem.rating,
        timestamp: sub.creationTimeSeconds * 1000,
        url: getProblemUrl(sub.problem.contestId, sub.problem.index),
      });
    }
  }

  // Today's summary
  const todayStr = format(referenceDate, 'yyyy-MM-dd');
  const todayMap = solvedByDate.get(todayStr) || new Map<string, SolvedProblemSummary>();
  const todayProblems = Array.from(todayMap.values());
  const todayCount = todayProblems.length;
  const isTodayTargetMet = todayCount >= dailyTarget;

  // Streak calculation
  // Check consecutive days backwards
  let currentStreak = 0;
  
  // If today is met, streak starts with today (1 + check yesterday)
  // If today is not met yet, streak is preserved from yesterday until end of today
  const checkStartDate = isTodayTargetMet ? referenceDate : subDays(referenceDate, 1);
  let dayCursor = checkStartDate;

  while (true) {
    const cursorStr = format(dayCursor, 'yyyy-MM-dd');
    const daySolves = solvedByDate.get(cursorStr)?.size || 0;
    
    if (daySolves >= dailyTarget) {
      currentStreak++;
      dayCursor = subDays(dayCursor, 1);
    } else {
      break;
    }

    // Safety limit to avoid infinite loops
    if (currentStreak > 365) break;
  }

  // Last 30 days activity summary
  const recentDays: HabitDaySummary[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = subDays(referenceDate, i);
    const dStr = format(d, 'yyyy-MM-dd');
    const count = solvedByDate.get(dStr)?.size || 0;
    recentDays.push({
      dateStr: dStr,
      solvedCount: count,
      targetMet: count >= dailyTarget,
    });
  }

  return {
    dailyTarget,
    todayCount,
    isTodayTargetMet,
    todayProblems,
    currentStreak,
    recentDays,
    lastUpdated: Date.now(),
  };
}
