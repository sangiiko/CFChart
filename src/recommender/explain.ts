import type { RecSlot } from '../types/codeforces';

export interface ExplainParams {
  slot: RecSlot;
  target: number;
  plannedMinutes: number;
  weakTag?: string;
}

/** Produce truthful, feature-derived reasons for a recommendation. */
export function explainRecommendation({ slot, target, plannedMinutes, weakTag }: ExplainParams): string[] {
  const reasons: string[] = [];

  switch (slot) {
    case 'revisit':
      reasons.push('Independent review after an assisted solve; the 3-day interval is a starting schedule.');
      break;
    case 'upsolve':
      reasons.push('Unfinished problem from a recent contest you participated in.');
      break;
    case 'guided':
      reasons.push('Study the missing idea, use hints or an editorial when needed, then record assistance.');
      break;
    case 'timed':
      reasons.push('Attempt without tags or hints within the allowance. Record time and any assistance.');
      break;
    case 'transfer':
      reasons.push(
        'New-to-your-observed-attempt-history task related to an earlier assisted solve. Attempt independently; this is a practice probe, not a standardized assessment.'
      );
      break;
    case 'stretch':
      reasons.push(`Challenging stretch task above target (${Math.round(target + 100)}+ rating).`);
      break;
    case 'warmup':
      reasons.push(`Quick warm-up problem below target rating.`);
      break;
    case 'core':
    default:
      reasons.push(`Within your current practice range (${Math.round(target - 200)}–${Math.round(target + 300)}).`);
      break;
  }

  if (weakTag && slot !== 'timed' && slot !== 'transfer') {
    reasons.push(`Recent timed feedback suggests more practice with ${weakTag}.`);
  }

  reasons.push(`${plannedMinutes}-minute practice allowance, not a predicted solve time.`);
  return reasons;
}
