import type { PracticeEvent, PracticeFeedback, PracticeLedger } from './types';

export const emptyLedger = (): PracticeLedger => ({ version: 1, events: [], assignments: [] });
export function validateFeedback(value: PracticeFeedback): void {
  if (!value || typeof value.id !== 'string' || !/^[\w.:-]{1,100}$/.test(value.id)
    || typeof value.problemKey !== 'string' || !/^\d+-[\w]+$/.test(value.problemKey)
    || !['independent', 'assisted', 'timeout', 'skipped', 'interrupted', 'already-solved', 'accepted'].includes(value.outcome)
    || (value.minutes !== undefined && (!Number.isFinite(value.minutes) || value.minutes < 0 || value.minutes > 1440))) {
    throw new Error('Invalid practice feedback.');
  }
}
export function appendEvent(ledger: PracticeLedger, event: PracticeEvent): PracticeLedger {
  validateFeedback(event);
  const existing = ledger.events.find(item => item.id === event.id);
  if (existing) {
    if (existing.problemKey !== event.problemKey || existing.outcome !== event.outcome || existing.minutes !== event.minutes) {
      throw new Error('This feedback ID has already been used.');
    }
    return ledger;
  }
  return { ...ledger, version: 1, events: [...ledger.events, event] };
}
export function latestEvents(events: PracticeEvent[]): Map<string, PracticeEvent> {
  const result = new Map<string, PracticeEvent>();
  for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))) result.set(event.problemKey, event);
  return result;
}
