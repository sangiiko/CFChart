import { describe, expect, it } from 'vitest';
import { isProblemEligible, isRecentUpsolve, isScheduledReview } from '../eligibility';
import { buildCandidates } from '../candidates';
import { explainRecommendation } from '../explain';
import { sessionUtility, improveSession, tagOverlapPenalty } from '../scheduler';
import { evaluateAnchorTransferValue, estimateTransferGain, FROZEN_ANCHOR_TASKS_V1 } from '../learning';
import { isCompetingRisksDeployable, defaultSessionAllowance } from '../time';
import { isRetentionModelDeployable, safeReviewIntervalDays } from '../retention';
import { createAssignmentRecord, DEFAULT_POLICY_EPSILON } from '../policy';
import { advanceUncertainty } from '../bayesian';
import { buildPracticeState } from '../state';
import { estimateSkill } from '../skill';
import { enrichCatalog, computeProblemQuality } from '../catalog';
import {
  problemEmbedding,
  semanticTagSimilarity,
  problemSimilarity,
  selectMostInformativeWeakTag,
  transferSimilarityScore,
  tagInformationWeight,
} from '../semantic';
import { zpdSuitabilityScore } from '../score';
import { summarizeRecommendationFeedback } from '../evaluation';
import type { RecommendedProblem, CFSubmission } from '../../types/codeforces';

const now = Date.UTC(2026, 10, 11);
const state = () => buildPracticeState([], [], 1400, true, [], now);
const problem = (id: number, rating = 1400, tags: string[] = []) => ({
  contestId: id,
  index: 'A',
  name: `Task ${id}`,
  rating,
  tags,
});
const catalog = (...ratings: number[]) => enrichCatalog(ratings.map((r, i) => problem(i + 1, r)), []);

describe('eligibility rules', () => {
  it('excludes solved tasks unless scheduled review', () => {
    const s = state();
    s.solved.add('1-A');
    const enriched = catalog(1400)[0];
    expect(isProblemEligible(enriched, s, { target: 1400, review: false })).toBe(false);
    expect(isProblemEligible(enriched, s, { target: 1400, review: true })).toBe(true);
    expect(isScheduledReview(enriched, s)).toBe(false);
  });

  it('strictly bounds difficulty and rejects distant fallbacks', () => {
    const s = state();
    const [p800, p1400, p2000] = catalog(800, 1400, 2000);
    // target 1400 -> bounds [1200, 1700]
    expect(isProblemEligible(p800, s, { target: 1400 })).toBe(false);
    expect(isProblemEligible(p1400, s, { target: 1400 })).toBe(true);
    expect(isProblemEligible(p2000, s, { target: 1400 })).toBe(false);
  });

  it('rejects unfinished contest tasks and zero-quality problems', () => {
    const s = state();
    const enriched = catalog(1400)[0];
    expect(isProblemEligible({ ...enriched, contestPhase: 'CODING' }, s, { target: 1400 })).toBe(false);
    expect(isProblemEligible({ ...enriched, qualityScore: 0 }, s, { target: 1400 })).toBe(false);
  });

  it('identifies recent upsolves correctly', () => {
    const s = state();
    s.participatedContests.add(1);
    s.attempted.set('1-A', { lastAttempt: now - 1000, count: 2 });
    const enriched = catalog(1400)[0];
    expect(isRecentUpsolve(enriched, s)).toBe(true);
    expect(isRecentUpsolve(catalog(1400)[0], state())).toBe(false);
  });
});

describe('candidate building and explanations', () => {
  it('builds candidates with correct slot and allowances', () => {
    const s = state();
    const skill = estimateSkill(s);
    const candidates = buildCandidates(catalog(1300, 1400, 1550), s, skill, 60);
    expect(candidates.length).toBe(3);
    const stretch = candidates.find(c => c.item.rating === 1550);
    expect(stretch?.item.slot).toBe('stretch');
    expect(stretch?.item.plannedMinutes).toBe(40);
  });

  it('generates truthful explanations for all slots without fake solve probabilities', () => {
    for (const slot of ['core', 'stretch', 'upsolve', 'revisit', 'timed', 'guided', 'transfer'] as const) {
      const reasons = explainRecommendation({ slot, target: 1400, plannedMinutes: 30, weakTag: 'dp' });
      expect(reasons.length).toBeGreaterThanOrEqual(2);
      expect(reasons.some(r => r.includes('30-minute practice allowance'))).toBe(true);
      expect(reasons.every(r => !r.includes('%'))).toBe(true);
    }
  });
});

describe('scheduler optimization', () => {
  it('penalizes duplicate contests and tags to promote topic diversity', () => {
    const p1: RecommendedProblem = {
      contestId: 10,
      index: 'A',
      name: 'P1',
      rating: 1400,
      tags: ['dp'],
      slot: 'core',
      slotLabel: 'Core',
      pSolve: null,
      plannedMinutes: 30,
      reasons: [],
      qualityScore: 1,
      url: '',
    };
    const p2SameContest: RecommendedProblem = { ...p1, index: 'B', name: 'P2', tags: ['graphs'] };
    const p3SameTag: RecommendedProblem = { ...p1, contestId: 20, name: 'P3', tags: ['dp'] };
    const p4Diverse: RecommendedProblem = { ...p1, contestId: 30, name: 'P4', tags: ['geometry'] };

    const utilDuplicate = sessionUtility([
      { item: p1, score: 1 },
      { item: p2SameContest, score: 1 },
    ]);
    const utilSameTag = sessionUtility([
      { item: p1, score: 1 },
      { item: p3SameTag, score: 1 },
    ]);
    const utilDiverse = sessionUtility([
      { item: p1, score: 1 },
      { item: p4Diverse, score: 1 },
    ]);
    expect(utilDiverse).toBeGreaterThan(utilDuplicate);
    expect(utilDiverse).toBeGreaterThan(utilSameTag);
  });

  it('preserves pinned items and stays strictly within budget', () => {
    const c = catalog(1400, 1400, 1400);
    const candidates = buildCandidates(c, state(), estimateSkill(state()), 60);
    const pinnedItem = candidates[0].item;
    const plan = improveSession([pinnedItem], candidates, 60, new Set(['1-A']));
    expect(plan.some(p => `${p.contestId}-${p.index}` === '1-A')).toBe(true);
    expect(plan.reduce((sum, p) => sum + p.plannedMinutes, 0)).toBeLessThanOrEqual(60);
  });
});

describe('topic skill estimation from public Codeforces data', () => {
  it('automatically discovers weak tags from public submission history without self-reporting', () => {
    const s = state();
    // Suppose user has attempted 10 dp problems with 1 solved, and 10 math problems with 9 solved
    s.tagActivity.set('dp', { accepted: 1, total: 10 });
    s.tagActivity.set('math', { accepted: 9, total: 10 });
    const skill = estimateSkill(s);
    expect(skill.globalTheta).toBe(1400);
    const dpTheta = skill.tagTheta.get('dp');
    const mathTheta = skill.tagTheta.get('math');
    expect(dpTheta).toBeDefined();
    expect(mathTheta).toBeDefined();
    expect(dpTheta!).toBeLessThan(1400);
    expect(mathTheta!).toBeGreaterThan(1400);
  });
});

describe('transfer and learning representation (Stage E)', () => {
  it('evaluates anchored transfer value over frozen distribution D', () => {
    expect(FROZEN_ANCHOR_TASKS_V1.length).toBe(6);
    const v1000 = evaluateAnchorTransferValue(1000);
    const v1800 = evaluateAnchorTransferValue(1800);
    expect(v1800).toBeGreaterThan(v1000);
    expect(v1000).toBeGreaterThan(0);
    expect(v1800).toBeLessThan(1);
  });

  it('flags transfer gains as unvalidated heuristic without causal claims', () => {
    const gain = estimateTransferGain(1400, 'core', 1500);
    expect(gain.validated).toBe(false);
    expect(gain.deltaTransfer).toBeGreaterThan(0);
    expect(gain.note).toContain('not prospective proof');
  });
});

describe('policy logging and disabled models', () => {
  it('creates assignment records with exact selection probability', () => {
    const p = catalog(1400)[0];
    const recItem: RecommendedProblem = {
      contestId: p.contestId!,
      index: p.index,
      name: p.name,
      rating: p.rating!,
      tags: p.tags,
      slot: 'core',
      slotLabel: 'Core',
      pSolve: null,
      plannedMinutes: 30,
      reasons: [],
      qualityScore: 1,
      url: '',
    };
    const record = createAssignmentRecord(recItem, 1400, true);
    expect(record.policy).toBe('adaptive-baseline-v2');
    expect(record.selectionProbability).toBe(1);
    expect(record.historyComplete).toBe(true);
    expect(DEFAULT_POLICY_EPSILON).toBe(0.0);
  });

  it('keeps unsupported models safely gated and provides working adaptive fallbacks', () => {
    expect(isCompetingRisksDeployable()).toBe(false);
    expect(isRetentionModelDeployable()).toBe(false);
    expect(defaultSessionAllowance('core', 60)).toBe(30);
    expect(defaultSessionAllowance('revisit', 60)).toBe(20);
    expect(defaultSessionAllowance('stretch', 60)).toBe(40);
    expect(safeReviewIntervalDays('assisted')).toBe(3);
    expect(safeReviewIntervalDays('skipped')).toBe(7);
  });

  it('advances uncertainty with drift without distorting mean ability', () => {
    const prior = { mean: [1400], covariance: [[100]] };
    const drifted = advanceUncertainty(prior, 0.5, 10);
    expect(drifted.mean[0]).toBe(1400);
    expect(drifted.covariance[0][0]).toBe(105);
  });

  it('predicts historical acceptance with exact Python/TypeScript numeric parity', async () => {
    const { predictHistoricalAcceptance, HISTORICAL_ACCEPTANCE_WEIGHTS } = await import('../score');
    expect(HISTORICAL_ACCEPTANCE_WEIGHTS[1]).toBeLessThan(0); // Monotone difficulty
    const pEqual = predictHistoricalAcceptance(1400, 1400);
    const pHarder = predictHistoricalAcceptance(1400, 1800);
    expect(pEqual).toBeCloseTo(0.9295, 3);
    expect(pHarder).toBeCloseTo(0.8810, 3);
    expect(pHarder).toBeLessThan(pEqual);
  });
});

describe('semantic concept embeddings, catalog quality, and IRT topic diagnostics', () => {
  it('computes Empirical-Bayes difficulty-calibrated problem quality scores', () => {
    // Missing or zero solvedCount defaults to 1.0
    expect(computeProblemQuality({ contestId: 1, index: 'A', name: 'T', rating: 1400, tags: [] })).toBe(1);
    const highSolve = computeProblemQuality(
      { contestId: 1, index: 'A', name: 'Popular', rating: 1600, tags: ['dp'], solvedCount: 12000 },
      { id: 1, name: 'Codeforces Round', type: 'CF', phase: 'FINISHED' }
    );
    const lowSolve = computeProblemQuality(
      { contestId: 2, index: 'F', name: 'Obscure', rating: 1600, tags: ['dp'], solvedCount: 150 },
      { id: 2, name: 'ICPC Regional', type: 'ICPC', phase: 'FINISHED' }
    );
    expect(highSolve).toBeGreaterThan(1.0);
    expect(lowSolve).toBeLessThan(1.0);
    expect(highSolve).toBeGreaterThan(lowSolve);
  });

  it('embeds techniques into unit-norm 8D vectors and computes semantic transfer similarity', () => {
    const embDp = problemEmbedding(['dp', 'bitmasks']);
    const norm = Math.hypot(...embDp);
    expect(norm).toBeCloseTo(1, 5);
    expect(semanticTagSimilarity(['trees'], ['dfs and similar'])).toBeGreaterThan(
      semanticTagSimilarity(['trees'], ['number theory'])
    );
    expect(
      problemSimilarity({ tags: ['dp', 'trees'], rating: 1500 }, { tags: ['trees', 'dfs and similar'], rating: 1500 })
    ).toBeGreaterThan(
      problemSimilarity({ tags: ['dp', 'trees'], rating: 1500 }, { tags: ['geometry', 'fft'], rating: 2100 })
    );
    expect(tagInformationWeight('fft')).toBeGreaterThan(tagInformationWeight('implementation'));

    const tagTheta = new Map<string, number>([
      ['implementation', 1350],
      ['trees', 1290],
      ['dp', 1450],
    ]);
    expect(selectMostInformativeWeakTag(['implementation', 'trees', 'dp'], tagTheta, 1400)).toBe('trees');

    const assistedProblem: RecommendedProblem = {
      contestId: 10,
      index: 'A',
      name: 'Tree Assist',
      rating: 1400,
      tags: ['trees', 'dfs and similar'],
      slot: 'core',
      slotLabel: 'Core',
      pSolve: null,
      plannedMinutes: 30,
      reasons: [],
      qualityScore: 1,
      url: '',
    };
    const transferScore = transferSimilarityScore(
      { tags: ['trees', 'graphs'], rating: 1400 },
      [
        {
          version: 1,
          id: 'assist-1',
          problemKey: '10-A',
          problem: assistedProblem,
          outcome: 'assisted',
          timestamp: now - 5 * 86400000,
          provenance: 'self-report',
        },
      ],
      now
    );
    expect(transferScore).toBeGreaterThan(0.5);
  });

  it('incorporates problem difficulty into IRT topic skill, uncertainty, and zero-sum contrasts', () => {
    const sub = (id: number, contestId: number, rating: number, tag: string, ok: boolean): CFSubmission => ({
      id,
      creationTimeSeconds: Math.floor(now / 1000) - (100 - id) * 3600,
      verdict: ok ? 'OK' : 'WRONG_ANSWER',
      problem: { contestId, index: 'A', name: `P${id}`, rating, tags: [tag] },
    });
    // Both 'graphs' and 'dp' have 50% raw acceptance (3/6),
    // but 'graphs' attempts are against 1900-rated problems while 'dp' attempts are against 900-rated problems,
    // and 'greedy' has 1/8 solved on 1000-rated problems.
    const submissions: CFSubmission[] = [
      sub(1, 101, 1900, 'graphs', true),
      sub(2, 102, 1900, 'graphs', true),
      sub(3, 103, 1900, 'graphs', true),
      sub(4, 104, 1900, 'graphs', false),
      sub(5, 105, 1900, 'graphs', false),
      sub(6, 106, 1900, 'graphs', false),
      sub(7, 201, 900, 'dp', true),
      sub(8, 202, 900, 'dp', true),
      sub(9, 203, 900, 'dp', true),
      sub(10, 204, 900, 'dp', false),
      sub(11, 205, 900, 'dp', false),
      sub(12, 206, 900, 'dp', false),
      sub(13, 301, 1000, 'greedy', true),
      sub(14, 302, 1000, 'greedy', false),
      sub(15, 303, 1000, 'greedy', false),
      sub(16, 304, 1000, 'greedy', false),
      sub(17, 305, 1000, 'greedy', false),
      sub(18, 306, 1000, 'greedy', false),
      sub(19, 307, 1000, 'greedy', false),
      sub(20, 308, 1000, 'greedy', false),
    ];
    const practiceState = buildPracticeState(submissions, [], 1400, true, [], now);
    const skill = estimateSkill(practiceState);
    const graphsTheta = skill.tagTheta.get('graphs')!;
    const dpTheta = skill.tagTheta.get('dp')!;
    expect(graphsTheta).toBeGreaterThan(dpTheta);
    expect(skill.tagUncertainty?.get('graphs')).toBeGreaterThan(0);
    expect(skill.weakTags).toContain('greedy');

    // Contrasts sum to zero around globalTheta
    const deltas = [...skill.tagTheta.values()].map(theta => theta - skill.globalTheta);
    const sumDeltas = deltas.reduce((acc, d) => acc + d, 0);
    expect(sumDeltas).toBeCloseTo(0, 6);
  });

  it('evaluates ZPD suitability, multi-tag overlap penalties, and shadow feedback metrics', () => {
    expect(zpdSuitabilityScore(0.75, 'core')).toBeGreaterThan(zpdSuitabilityScore(0.2, 'core'));
    expect(zpdSuitabilityScore(0.55, 'stretch')).toBeGreaterThan(zpdSuitabilityScore(0.95, 'stretch'));
    expect(tagOverlapPenalty(['dp', 'trees'], ['dp', 'trees'])).toBeGreaterThan(
      tagOverlapPenalty(['dp'], ['dp'])
    );

    const recProblem: RecommendedProblem = {
      contestId: 10,
      index: 'A',
      name: 'Task',
      rating: 1400,
      tags: ['dp'],
      slot: 'core',
      slotLabel: 'Core',
      pSolve: null,
      shadowAcceptance: 0.8,
      plannedMinutes: 30,
      reasons: [],
      qualityScore: 1,
      url: '',
    };
    const summary = summarizeRecommendationFeedback({
      version: 1,
      events: [
        {
          version: 1,
          id: 'ev-1',
          problemKey: '10-A',
          problem: recProblem,
          outcome: 'independent',
          timestamp: 2000,
          provenance: 'self-report',
        },
      ],
      assignments: [
        {
          id: 'assign:2026-11-10:10-A:core',
          timestamp: 1000,
          policy: 'adaptive-baseline-v2',
          problem: recProblem,
          selectionProbability: 1,
          rating: 1400,
          historyComplete: true,
        },
      ],
      impressions: [
        {
          id: 'imp-1',
          problemKey: '10-A',
          day: '2026-11-10',
          displayedAt: 1500,
          position: 0,
        },
      ],
    });
    expect(summary.shadowPredictionMean).toBeCloseTo(0.8, 5);
    expect(summary.shadowBrier).toBeCloseTo(0.04, 5);
    expect(summary.shadowLogLoss).toBeCloseTo(-Math.log(0.8), 5);
    expect(summary.independentSolveRate).toBe(1);
    expect(summary.bySlot?.core.impressions).toBe(1);
  });
});
