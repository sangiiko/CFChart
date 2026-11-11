/** Explicit wall-clock session timing. Running timers continue across popup closes. */
export type SessionAction = 'start' | 'pause' | 'resume' | 'assistance' | 'stop';
export interface SessionEvent { id: string; at: number; problemKey: string; action: SessionAction }
export interface SessionState { problemKey: string; elapsedMs: number; runningSince: number | null; stopped: boolean; assistanceAtMs: number | null }
export function replaySession(events: SessionEvent[], key: string, now: number): SessionState | null {
  let state: SessionState | null = null;
  for (const event of events) {
    if (event.problemKey !== key || event.at > now) continue;
    if (event.action === 'start') state = { problemKey: key, elapsedMs: 0, runningSince: event.at, stopped: false, assistanceAtMs: null };
    else if (state) {
      const elapsed = state.elapsedMs + (state.runningSince === null ? 0 : Math.max(0, event.at - state.runningSince));
      if (event.action === 'assistance') { if (state.assistanceAtMs === null) state.assistanceAtMs = elapsed; }
      else if (event.action === 'resume') state.runningSince = event.at;
      else { state.elapsedMs = elapsed; state.runningSince = null; state.stopped = event.action === 'stop'; }
    }
  }
  return state;
}
export function sessionElapsed(state: SessionState | null, now: number): number {
  return state ? state.elapsedMs + (state.runningSince === null ? 0 : Math.max(0, now - state.runningSince)) : 0;
}
export function appendSession(events: SessionEvent[], event: SessionEvent): SessionEvent[] {
  if (!event || !/^[\w-]{1,100}$/.test(event.id) || !/^\d+-\w+$/.test(event.problemKey)
    || !Number.isFinite(event.at) || !['start','pause','resume','assistance','stop'].includes(event.action)) throw new Error('Invalid session event.');
  const previous = events.find(e => e.id === event.id);
  if (previous) {
    if (previous.problemKey !== event.problemKey || previous.action !== event.action) throw new Error('Session event ID already used.');
    return events;
  }
  if (events.some(e => e.at > event.at)) throw new Error('Clock moved backwards. Restore the clock before recording time.');
  const state = replaySession(events, event.problemKey, event.at);
  if (event.action === 'start' && state && !state.stopped) throw new Error('Session already started.');
  if (event.action !== 'start' && (!state || state.stopped)) throw new Error('Start a session first.');
  if (event.action === 'resume' && state?.runningSince !== null) throw new Error('Timer is already running.');
  if (event.action === 'pause' && state?.runningSince === null) throw new Error('Timer is already paused.');
  if (event.action === 'start' || event.action === 'resume') {
    for (const key of new Set(events.map(e => e.problemKey))) {
      const other = replaySession(events, key, event.at);
      if (key !== event.problemKey && other?.runningSince != null) throw new Error('Pause your other running task first.');
    }
  }
  return [...events, event];
}
