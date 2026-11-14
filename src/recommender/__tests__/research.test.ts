import { describe, expect, it } from 'vitest';
import { appendSession, replaySession, sessionElapsed } from '../session';
import { competingRisks } from '../time';
import { recallProbability, reviewDelay, estimateMemoryState } from '../retention';
import { posteriorSolve, topicFeatures, updateBelief, expectedInformationGain, ucbScore } from '../bayesian';
import { explorationDistribution, samplePolicy, selectNearTieExplorationSlot } from '../policy';
describe('session replay', () => {
  it('persists active intervals and assistance independently from pauses', () => {
    let events = appendSession([], { id:'a', at:1000, problemKey:'1-A', action:'start' });
    events = appendSession(events, { id:'b', at:61000, problemKey:'1-A', action:'pause' });
    events = appendSession(events, { id:'c', at:121000, problemKey:'1-A', action:'resume' });
    events = appendSession(events, { id:'d', at:151000, problemKey:'1-A', action:'assistance' });
    const state = replaySession(events,'1-A',181000);
    expect(sessionElapsed(state,181000)).toBe(120000);
    expect(state?.assistanceAtMs).toBe(90000);
    expect(appendSession(events,events[3])).toBe(events);
    expect(() => appendSession(events,{id:'e',at:181000,problemKey:'2-A',action:'start'})).toThrow('other');
  });
});
describe('research model mechanics', () => {
  it('conserves competing-risk mass and accounts for survival time', () => {
    const result = competingRisks([[0,0,0,0],[0,0,0,0]],5);
    expect(result.solve+result.assistance+result.stop+result.survival).toBeCloseTo(1);
    expect(result.expectedMinutes).toBeCloseTo(6.25);
    expect(result.solve).toBeCloseTo(.3125);
  });
  it('inverts retention thresholds and estimates DSR memory urgency', () => {
    expect(recallProbability(reviewDelay(4,.8),4)).toBeCloseTo(.8);
    expect(() => reviewDelay(4,1)).toThrow();
    const day = 86_400_000;
    const now = 100 * day;
    const baseProb = { contestId: 1, index: 'A', name: 'P', rating: 1500, tags: ['dp'], slot: 'core' as const, slotLabel: 'Core', pSolve: null, plannedMinutes: 30, reasons: [], qualityScore: 1, url: '' };
    const recentAssisted = estimateMemoryState('1-A', [
      { id: '1', version: 1, problemKey: '1-A', outcome: 'assisted', timestamp: now - 4 * day, problem: baseProb, provenance: 'self-report' },
    ], now, 1500, 1400);
    const overdueRepeatedLapse = estimateMemoryState('1-A', [
      { id: '1', version: 1, problemKey: '1-A', outcome: 'assisted', timestamp: now - 20 * day, problem: baseProb, provenance: 'self-report' },
      { id: '2', version: 1, problemKey: '1-A', outcome: 'assisted', timestamp: now - 12 * day, problem: baseProb, provenance: 'self-report' },
    ], now, 1500, 1400);
    expect(overdueRepeatedLapse.lapses).toBe(2);
    expect(overdueRepeatedLapse.stabilityDays).toBeLessThan(recentAssisted.stabilityDays);
    expect(overdueRepeatedLapse.urgency).toBeGreaterThan(recentAssisted.urgency);
  });
  it('updates posterior means, reduces uncertainty, and computes expected information gain and UCB', () => {
    const prior = {mean:[0],covariance:[[1]]};
    const next = updateBelief(prior,[1],0,1);
    expect(next.mean[0]).toBeCloseTo(.4);
    expect(next.covariance[0][0]).toBeCloseTo(.8);
    expect(posteriorSolve(prior,[1],0)).toBeCloseTo(.5);
    expect(topicFeatures([.5,.5])).toEqual([1,0]);
    // Information gain is highest near 50% solve probability (difficulty = mean = 0) vs extreme difficulty
    const eigMatched = expectedInformationGain(prior, [1], 0);
    const eigExtreme = expectedInformationGain(prior, [1], 5);
    expect(eigMatched).toBeGreaterThan(eigExtreme);
    expect(ucbScore(prior, [1], 0, 1.0)).toBeCloseTo(1.5);
  });
  it('logs exact eligible-action exploration probabilities and near-tie bandit slots', () => {
    const p = explorationDistribution(['core','review'],'core',.1);
    expect(p.core).toBeCloseTo(.95); expect(p.review).toBeCloseTo(.05);
    expect(samplePolicy(p,.99)).toBe('review');
    expect(() => explorationDistribution(['core'],'missing',.1)).toThrow();

    const makeCand = (id: number, score: number) => ({
      score,
      item: { contestId: id, index: 'A', name: `T${id}`, rating: 1400, tags: [], slot: 'core' as const, slotLabel: 'Core', pSolve: null, plannedMinutes: 30, reasons: [], qualityScore: 1, url: '' },
    });
    const res = selectNearTieExplorationSlot([makeCand(1, 1.0), makeCand(2, 0.95), makeCand(3, 0.5)], 0.1, 0.99, 0.1);
    expect(res.supportKeys).toEqual(['1-A', '2-A']);
    expect(res.chosenKey).toBe('2-A');
    expect(res.chosenProbability).toBeCloseTo(0.05);
  });
});
