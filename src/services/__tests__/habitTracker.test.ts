import { describe, it, expect } from 'vitest';
import { calculateHabitProgress } from '../habitTracker';
import { CFSubmission } from '../../types/codeforces';

describe('habitTracker', () => {
  it('correctly counts today accepted problems and ignores duplicates', () => {
    const today = new Date('2026-11-10T15:00:00Z');
    const todaySec = Math.floor(today.getTime() / 1000);

    const submissions: CFSubmission[] = [
      {
        id: 101,
        creationTimeSeconds: todaySec - 3600,
        verdict: 'OK',
        problem: { contestId: 158, index: 'A', name: 'Next Round', tags: [] }
      },
      // Duplicate submission of same problem
      {
        id: 102,
        creationTimeSeconds: todaySec - 1800,
        verdict: 'OK',
        problem: { contestId: 158, index: 'A', name: 'Next Round', tags: [] }
      },
      // Non-OK submission
      {
        id: 103,
        creationTimeSeconds: todaySec - 1200,
        verdict: 'WRONG_ANSWER',
        problem: { contestId: 71, index: 'A', name: 'Way Too Long Words', tags: [] }
      },
      // Second accepted distinct problem
      {
        id: 104,
        creationTimeSeconds: todaySec - 600,
        verdict: 'OK',
        problem: { contestId: 71, index: 'A', name: 'Way Too Long Words', tags: [] }
      }
    ];

    const progress = calculateHabitProgress(submissions, 2, today);
    expect(progress.todayCount).toBe(2);
    expect(progress.isTodayTargetMet).toBe(true);
    expect(progress.todayProblems.length).toBe(2);
  });

  it('calculates active streak correctly', () => {
    const today = new Date('2026-11-10T12:00:00Z');
    const oneDay = 86400;
    const nowSec = Math.floor(today.getTime() / 1000);

    const submissions: CFSubmission[] = [
      // Day -2 (2 problems)
      { id: 1, creationTimeSeconds: nowSec - 2 * oneDay, verdict: 'OK', problem: { contestId: 1, index: 'A', name: 'P1', tags: [] } },
      { id: 2, creationTimeSeconds: nowSec - 2 * oneDay + 100, verdict: 'OK', problem: { contestId: 1, index: 'B', name: 'P2', tags: [] } },
      // Day -1 (2 problems)
      { id: 3, creationTimeSeconds: nowSec - 1 * oneDay, verdict: 'OK', problem: { contestId: 2, index: 'A', name: 'P3', tags: [] } },
      { id: 4, creationTimeSeconds: nowSec - 1 * oneDay + 100, verdict: 'OK', problem: { contestId: 2, index: 'B', name: 'P4', tags: [] } },
      // Today (1 problem so far)
      { id: 5, creationTimeSeconds: nowSec, verdict: 'OK', problem: { contestId: 3, index: 'A', name: 'P5', tags: [] } },
    ];

    const progress = calculateHabitProgress(submissions, 2, today);
    expect(progress.todayCount).toBe(1);
    expect(progress.isTodayTargetMet).toBe(false);
    // Streak from yesterday is 2
    expect(progress.currentStreak).toBe(2);
  });

  it('includes practice events (e.g. self-reports or in-page solves) in daily progress', () => {
    const today = new Date('2026-11-10T12:00:00Z');
    const todayMs = today.getTime();

    const progress = calculateHabitProgress(
      [],
      2,
      today,
      { complete: true, loaded: 0 },
      [
        {
          id: 'event-1',
          version: 1,
          problemKey: '100-A',
          outcome: 'independent',
          timestamp: todayMs - 1000,
          provenance: 'self-report',
          problem: {
            contestId: 100,
            index: 'A',
            name: 'Problem 100A',
            rating: 1200,
            tags: [],
            slot: 'core',
            slotLabel: 'Practice',
            pSolve: null,
            plannedMinutes: 30,
            reasons: [],
            qualityScore: 1,
            url: 'https://codeforces.com/problemset/problem/100/A',
          },
        },
        {
          id: 'event-2',
          version: 1,
          problemKey: '200-B',
          outcome: 'assisted',
          timestamp: todayMs - 500,
          provenance: 'self-report',
          problem: {
            contestId: 200,
            index: 'B',
            name: 'Problem 200B',
            rating: 1300,
            tags: [],
            slot: 'core',
            slotLabel: 'Practice',
            pSolve: null,
            plannedMinutes: 30,
            reasons: [],
            qualityScore: 1,
            url: 'https://codeforces.com/problemset/problem/200/B',
          },
        },
      ]
    );

    expect(progress.todayCount).toBe(2);
    expect(progress.isTodayTargetMet).toBe(true);
    expect(progress.todayProblems).toHaveLength(2);
    expect(progress.todayProblems[0].key).toBe('200-B');
    expect(progress.todayProblems[1].key).toBe('100-A');
  });

  it('does not count a review or re-solve of an earlier-day problem toward today daily goal', () => {
    const today = new Date('2026-11-10T12:00:00Z');
    const todayMs = today.getTime();
    const threeDaysAgoMs = todayMs - 3 * 86400000;

    const progress = calculateHabitProgress(
      [],
      1,
      today,
      { complete: true, loaded: 0 },
      [
        {
          id: 'earlier-assisted',
          version: 1,
          problemKey: '100-A',
          outcome: 'assisted',
          timestamp: threeDaysAgoMs,
          provenance: 'self-report',
          problem: {
            contestId: 100,
            index: 'A',
            name: 'Problem 100A',
            rating: 1200,
            tags: [],
            slot: 'core',
            slotLabel: 'Practice',
            pSolve: null,
            plannedMinutes: 30,
            reasons: [],
            qualityScore: 1,
            url: 'https://codeforces.com/problemset/problem/100/A',
          },
        },
        {
          id: 'today-review',
          version: 1,
          problemKey: '100-A',
          outcome: 'independent',
          timestamp: todayMs - 1000,
          provenance: 'self-report',
          problem: {
            contestId: 100,
            index: 'A',
            name: 'Problem 100A',
            rating: 1200,
            tags: [],
            slot: 'revisit',
            slotLabel: 'Independent review',
            pSolve: null,
            plannedMinutes: 20,
            reasons: [],
            qualityScore: 1,
            url: 'https://codeforces.com/problemset/problem/100/A',
          },
        },
      ]
    );

    expect(progress.todayCount).toBe(0);
    expect(progress.isTodayTargetMet).toBe(false);
  });
});
