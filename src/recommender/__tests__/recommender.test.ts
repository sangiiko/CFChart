import { describe, expect, it } from 'vitest';
import { selectRecommendationsV2, selectScheduledReviews } from '..';
import { enrichCatalog } from '../catalog';
import { buildPracticeState } from '../state';
import { estimateSkill } from '../skill';
import { appendEvent, emptyLedger } from '../events';
import type { CFSubmission, RecommendedProblem } from '../../types/codeforces';
import type { PracticeEvent } from '../types';

const now = Date.UTC(2026, 10, 11);
const state = () => buildPracticeState([], [], 1400, true, [], now);
const problem = (id: number, rating = 1400, tags: string[] = []) => ({ contestId: id, index: 'A', name: `Task ${id}`, rating, tags });
const catalog = (...ratings: number[]) => enrichCatalog(ratings.map((r, i) => problem(i + 1, r)), []);
function event(id: number, outcome: PracticeEvent['outcome'] = 'independent', daysAgo = 1): PracticeEvent {
  const p: RecommendedProblem = { ...problem(id, 1400, ['dp']), slot: 'core', slotLabel: 'Core practice', pSolve: null,
    plannedMinutes: 30, reasons: [], qualityScore: 1, url: `https://codeforces.com/problemset/problem/${id}/A` };
  return { id: `event-${id}`, version: 1, problemKey: `${id}-A`, outcome, minutes: 30,
    timestamp: now - daysAgo * 86400000, problem: p, provenance: 'self-report' };
}

describe('production selector safety and scheduling', () => {
  it('never returns solved or distant fallback tasks, even when exhausted', () => {
    const s = state(); s.solved.add('1-A');
    expect(selectRecommendationsV2(catalog(1400), s, 5)).toEqual([]);
    expect(selectRecommendationsV2(catalog(800, 3000), state(), 5)).toEqual([]);
    expect(selectRecommendationsV2(catalog(1400), { ...state(), historyComplete: false }, 2)).toEqual([]);
  });
  it('rejects malformed, duplicate, special, and unfinished tasks but keeps Kotlin rounds', () => {
    const result = enrichCatalog([problem(1), problem(1), problem(2), problem(3), { ...problem(4), rating: NaN }, problem(5, 1400, ['*special'])], [
      { id: 1, name: 'Kotlin Heroes', phase: 'FINISHED', type: 'ICPC' }, { id: 2, name: 'April Fools', phase: 'FINISHED', type: 'CF' },
      { id: 3, name: 'Round', phase: 'CODING', type: 'CF' },
    ]);
    expect(result.map(p => p.contestId)).toEqual([1]);
  });
  it('uses absolute links, truthful slots, bounded budgets, and no invented probabilities', () => {
    const result = selectRecommendationsV2(catalog(1300, 1400, 1500, 1600), state(), 10, 60);
    expect(result.length).toBeGreaterThan(0);
    expect(result.reduce((n, p) => n + p.plannedMinutes, 0)).toBeLessThanOrEqual(60);
    expect(result.every(p => p.url.startsWith('https://codeforces.com/') && p.pSolve === null)).toBe(true);
    expect(selectRecommendationsV2(catalog(1400), state(), 1, 20)[0].plannedMinutes).toBe(20);
    expect(selectRecommendationsV2(catalog(1400), state(), -1)).toEqual([]);
  });
  it('is independent of catalog ordering and keeps eligible pinned tasks', () => {
    const c = catalog(1400, 1400, 1400);
    const first = selectRecommendationsV2(c, state(), 1);
    expect(selectRecommendationsV2([...c].reverse(), state(), 1)).toEqual(first);
    const pin = selectRecommendationsV2(c.slice(2), state(), 1);
    expect(selectRecommendationsV2(c, state(), 1, 60, pin)).toEqual(pin);
  });
  it('selects recent contest upsolves and explicit assisted reviews with 6d initial / 4d repeat-lapse spacing', () => {
    const s = state(); s.participatedContests.add(1); s.attempted.set('1-A', { lastAttempt: now - 1000, count: 3 });
    expect(selectRecommendationsV2(catalog(1400), s, 1)[0].slot).toBe('upsolve');
    // Not due after 4 days (6-day initial interval avoids verbatim recall), due at 6+ days
    const assisted4d = event(1, 'assisted', 4);
    expect(selectScheduledReviews(catalog(1400), buildPracticeState([], [], 1400, true, [assisted4d], now))).toEqual([]);
    const assisted7d = event(1, 'assisted', 7);
    const review = buildPracticeState([], [], 1400, true, [assisted7d], now);
    expect(selectRecommendationsV2(catalog(1400), review, 1)[0].slot).toBe('revisit');
    expect(selectRecommendationsV2(catalog(1400), { ...review, events: [event(1, 'assisted', 1)] }, 1)).toEqual([]);
    // A second assisted lapse tightens retry spacing to 4 days
    const repeatLapse = [
      { ...event(1, 'assisted', 12), id: 'assist-first' },
      { ...event(1, 'assisted', 4), id: 'assist-second' },
    ];
    expect(selectScheduledReviews(catalog(1400), buildPracticeState([], [], 1400, true, repeatLapse, now))).toHaveLength(1);
  });
  it('retains scheduled reviews across old contests and rating shifts', () => {
    const oldStart = Math.floor((now - 5 * 365 * 86400000) / 1000);
    const modernStart = Math.floor((now - 30 * 86400000) / 1000);
    const mixed = enrichCatalog([problem(1, 1000), problem(2, 1400), problem(3, 1400)], [
      { id: 1, name: 'Old Round', phase: 'FINISHED', type: 'CF', startTimeSeconds: oldStart },
      { id: 2, name: 'New Round 1', phase: 'FINISHED', type: 'CF', startTimeSeconds: modernStart },
      { id: 3, name: 'New Round 2', phase: 'FINISHED', type: 'CF', startTimeSeconds: modernStart },
    ]);
    const assisted = event(1, 'assisted', 7);
    const review = buildPracticeState([], [], 1400, true, [assisted], now);
    expect(selectScheduledReviews(mixed, review).map(p => p.contestId)).toEqual([1]);
    expect(selectRecommendationsV2(mixed, review, 3, 120).some(p => p.contestId === 1 && p.slot === 'revisit')).toBe(true);
  });
  it('caps scheduled reviews to at most 1 per day and stops once a review is acted on today', () => {
    const fiveProblems = catalog(1400, 1400, 1400, 1400, 1400);
    const fiveDueEvents = [1, 2, 3, 4, 5].map(id => event(id, 'assisted', 7));
    const reviewState = buildPracticeState([], [], 1400, true, fiveDueEvents, now);
    const scheduled = selectScheduledReviews(fiveProblems, reviewState);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].slot).toBe('revisit');

    const sessionRecs = selectRecommendationsV2(fiveProblems, reviewState, 3, 120);
    expect(sessionRecs.filter(p => p.slot === 'revisit')).toHaveLength(1);

    // Once the user completes or snoozes 1 review today, no more reviews are pushed today
    const completedToday: PracticeEvent = {
      ...event(1, 'independent', 0),
      id: 'completed-today-1',
      timestamp: now - 1000,
    };
    const afterOneReview = buildPracticeState([], [], 1400, true, [...fiveDueEvents, completedToday], now);
    expect(selectScheduledReviews(fiveProblems, afterOneReview)).toEqual([]);
  });
  it('builds a balanced core + stretch 2-problem session and supports below-rating light-day warmups', () => {
    const mixedCatalog = enrichCatalog(
      [
        problem(1, 1200, ['implementation']),
        problem(2, 1300, ['dp']),
        problem(3, 1400, ['graphs']),
        problem(4, 1500, ['trees']),
        problem(5, 1600, ['math']),
      ],
      []
    );
    const normal = selectRecommendationsV2(mixedCatalog, state(), 2, 70);
    expect(normal.map(p => p.slot)).toEqual(['core', 'stretch']);
    expect(normal[0].rating).toBeLessThanOrEqual(1450);
    expect(normal[1].rating).toBeGreaterThan(1450);

    const lightState = { ...state(), lightDay: true };
    const lightPicks = selectRecommendationsV2(mixedCatalog, lightState, 2, 70);
    expect(lightPicks.length).toBeGreaterThan(0);
    expect(lightPicks.every(p => p.slot === 'warmup' && p.rating <= 1400)).toBe(true);
    expect(lightPicks[0].rating).toBeLessThan(1400);
  });
});

describe('evidence and adaptation', () => {
  it('deduplicates submissions, discounts assisted solves from topic mastery, and keeps API solves neutral for globalTheta', () => {
    const sub = (id: number, verdict: string): CFSubmission => ({ id, creationTimeSeconds: now / 1000 - 10, problem: problem(1, 1400, ['dp']), verdict });
    const s = buildPracticeState([sub(1, 'WRONG_ANSWER'), sub(1, 'WRONG_ANSWER'), sub(2, 'OK')], [], 1400, true, [], now);
    expect(s.attempted.get('1-A')?.count).toBe(2);
    expect(s.tagActivity.get('dp')).toEqual({ accepted: 1, total: 1 });
    expect(estimateSkill(s).globalTheta).toBe(1400); // API acceptance has unknown assistance and time.

    const sAssisted = buildPracticeState([sub(2, 'OK')], [], 1400, true, [event(1, 'assisted', 1)], now);
    expect(sAssisted.tagActivity.get('dp')).toEqual({ accepted: 0, total: 1 });
  });
  it('calibrates globalTheta from independent, assisted, and 40-45m timed outcomes via MAP IRT', () => {
    expect(estimateSkill({ ...state(), events: [event(1)] }).globalTheta).toBe(1400);
    expect(estimateSkill({ ...state(), events: [event(1), event(2), event(3)] }).globalTheta).toBeGreaterThan(1400);
    // Independent solves taking 42 minutes (above old 30m cap) still count toward ability
    const slowIndep = [1, 2, 3].map(id => ({ ...event(id, 'independent', id), minutes: 42 }));
    expect(estimateSkill({ ...state(), events: slowIndep }).globalTheta).toBeGreaterThan(1400);
    // Repeated assisted outcomes lower calibrated independent practice level
    expect(estimateSkill({ ...state(), events: [event(1, 'assisted'), event(2, 'assisted'), event(3, 'assisted')] }).globalTheta).toBeLessThan(1400);
    // 80% assisted at +100 rating pulls globalTheta meaningfully down so recommendations become tractable
    const eightyPctStuck = Array.from({ length: 10 }, (_, i) => {
      const ev = event(i + 1, i < 2 ? 'independent' : 'assisted', i + 1);
      return { ...ev, minutes: 42, problem: { ...ev.problem, rating: 1500 } };
    });
    expect(estimateSkill({ ...state(), events: eightyPctStuck }).globalTheta).toBeLessThan(1360);
    expect(estimateSkill({ ...state(), events: [event(1, 'timeout'), event(2, 'timeout'), event(3, 'timeout')] }).globalTheta).toBeLessThan(1400);
    expect(estimateSkill({ ...state(), events: [event(1), event(1), event(1)] }).evidenceCount).toBe(1);
  });
  it('keeps feedback idempotent and detects conflicting event IDs', () => {
    const ledger = appendEvent(emptyLedger(), event(1));
    expect(appendEvent(ledger, event(1))).toBe(ledger);
    expect(() => appendEvent(ledger, event(1, 'timeout'))).toThrow();
  });
});
