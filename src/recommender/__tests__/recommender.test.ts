import { describe, expect, it } from 'vitest';
import { selectRecommendationsV2 } from '..';
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
  it('selects recent contest upsolves and explicit assisted reviews', () => {
    const s = state(); s.participatedContests.add(1); s.attempted.set('1-A', { lastAttempt: now - 1000, count: 3 });
    expect(selectRecommendationsV2(catalog(1400), s, 1)[0].slot).toBe('upsolve');
    const assisted = event(1, 'assisted', 4);
    const review = buildPracticeState([], [], 1400, true, [assisted], now);
    expect(selectRecommendationsV2(catalog(1400), review, 1)[0].slot).toBe('revisit');
    expect(selectRecommendationsV2(catalog(1400), { ...review, events: [event(1, 'assisted', 1)] }, 1)).toEqual([]);
  });
});

describe('evidence and adaptation', () => {
  it('deduplicates submissions and counts problems rather than wrong submissions for topic activity', () => {
    const sub = (id: number, verdict: string): CFSubmission => ({ id, creationTimeSeconds: now / 1000 - 10, problem: problem(1, 1400, ['dp']), verdict });
    const s = buildPracticeState([sub(1, 'WRONG_ANSWER'), sub(1, 'WRONG_ANSWER'), sub(2, 'OK')], [], 1400, true, [], now);
    expect(s.attempted.get('1-A')?.count).toBe(2);
    expect(s.tagActivity.get('dp')).toEqual({ accepted: 1, total: 1 });
    expect(estimateSkill(s).globalTheta).toBe(1400); // API acceptance has unknown assistance and time.
  });
  it('adapts only from sufficient independent timed evidence and treats assistance as unknown ability', () => {
    expect(estimateSkill({ ...state(), events: [event(1)] }).globalTheta).toBe(1400);
    expect(estimateSkill({ ...state(), events: [event(1), event(2), event(3)] }).globalTheta).toBeGreaterThan(1400);
    expect(estimateSkill({ ...state(), events: [event(1, 'assisted'), event(2, 'assisted'), event(3, 'assisted')] }).globalTheta).toBe(1400);
    expect(estimateSkill({ ...state(), events: [event(1, 'timeout'), event(2, 'timeout'), event(3, 'timeout')] }).globalTheta).toBeLessThan(1400);
    expect(estimateSkill({ ...state(), events: [event(1), event(1), event(1)] }).evidenceCount).toBe(1);
  });
  it('keeps feedback idempotent and detects conflicting event IDs', () => {
    const ledger = appendEvent(emptyLedger(), event(1));
    expect(appendEvent(ledger, event(1))).toBe(ledger);
    expect(() => appendEvent(ledger, event(1, 'timeout'))).toThrow();
  });
});
