import { describe, expect, it } from 'vitest';
import { appendSession, replaySession, sessionElapsed } from '../session';
import { competingRisks } from '../time';
import { recallProbability, reviewDelay } from '../retention';
import { posteriorSolve, topicFeatures, updateBelief } from '../bayesian';
import { explorationDistribution, samplePolicy } from '../policy';
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
  it('inverts retention thresholds', () => {
    expect(recallProbability(reviewDelay(4,.8),4)).toBeCloseTo(.8);
    expect(() => reviewDelay(4,1)).toThrow();
  });
  it('updates posterior means, reduces uncertainty and integrates predictive uncertainty', () => {
    const prior = {mean:[0],covariance:[[1]]};
    const next = updateBelief(prior,[1],0,1);
    expect(next.mean[0]).toBeCloseTo(.4);
    expect(next.covariance[0][0]).toBeCloseTo(.8);
    expect(posteriorSolve(prior,[1],0)).toBeCloseTo(.5);
    expect(topicFeatures([.5,.5])).toEqual([1,0]);
  });
  it('logs exact eligible-action exploration probabilities', () => {
    const p = explorationDistribution(['core','review'],'core',.1);
    expect(p.core).toBeCloseTo(.95); expect(p.review).toBeCloseTo(.05);
    expect(samplePolicy(p,.99)).toBe('review');
    expect(() => explorationDistribution(['core'],'missing',.1)).toThrow();
  });
});
