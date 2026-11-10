import { describe, expect, it } from 'vitest';
import { calculateHabitProgress } from '../habitTracker';
import type { CFSubmission } from '../../types/codeforces';

const now = new Date(2026, 10, 10, 12);
const sub = (id: number, date: Date): CFSubmission => ({ id, creationTimeSeconds: date.getTime() / 1000, verdict: 'OK', problem: { contestId: id, index: 'A', name: 'Task', tags: [] } });

describe('history coverage and calendar days', () => {
  it('marks the oldest partial day and earlier days unknown while retaining known successes', () => {
    const yesterday = new Date(2026, 10, 9, 12);
    const submissions = [sub(1, now), sub(2, yesterday)];
    const progress = calculateHabitProgress(submissions, 1, now, { complete: false, loaded: 2, earliestTime: yesterday.getTime() / 1000 });
    expect(progress.recentDays[29]?.unknown).toBe(false);
    expect(progress.recentDays[28]?.unknown).toBe(true);
    expect(progress.currentStreak).toBe(2);
    expect(progress.streakIsLowerBound).toBe(true);
  });

  it('uses local midnight and counts distinct tasks separately on separate days', () => {
    const today = new Date(2026, 10, 10, 0, 1);
    const yesterday = new Date(2026, 10, 9, 23, 59);
    const repeated = { ...sub(1, yesterday), id: 2 };
    const progress = calculateHabitProgress([sub(1, today), repeated], 1, now);
    expect(progress.todayCount).toBe(1);
    expect(progress.currentStreak).toBe(2);
    expect(progress.historyComplete).toBe(true);
  });

  it('recomputes today at rollover and does not label incomplete empty history as known zero', () => {
    const empty = calculateHabitProgress([], 2, now, { complete: false, loaded: 0 });
    expect(empty.recentDays.every(day => day.unknown)).toBe(true);
    expect(empty.recentDays[29].unknown).toBe(true);
    const tomorrow = new Date(2026, 10, 11, 0, 1);
    expect(calculateHabitProgress([sub(1, now)], 1, tomorrow).todayCount).toBe(0);
    expect(calculateHabitProgress([sub(1, now)], 1, tomorrow).currentStreak).toBe(1);
  });
});
