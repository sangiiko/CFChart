import React, { useEffect, useState, useRef, useId } from 'react';
import { practiceSession } from '../../services/extensionClient';
import type { SessionAction } from '../../recommender/session';

export interface StoredTimerState {
  problemKey: string;
  elapsedMs: number;
  runningSince: number | null;
  mode: 'stopwatch' | 'countdown';
  countdownLimitMinutes: number;
  alertAcknowledged: boolean;
}

export const STORAGE_PREFIX = 'cfchart_timer_';
export const DURATION_PREFERENCE_KEY = 'cfchart_timer_duration_minutes';

export function getTimerStorageKey(problemKey: string): string {
  return `${STORAGE_PREFIX}${problemKey}`;
}

const memoryFallback = new Map<string, string>();
const preferenceFallback = new Map<string, string>();

function getPreferredDuration(): number {
  try {
    const raw = window.localStorage.getItem(DURATION_PREFERENCE_KEY);
    const minutes = Number(raw);
    if (raw !== null && Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440) return minutes;
  } catch {
    const raw = preferenceFallback.get(DURATION_PREFERENCE_KEY);
    if (raw) return Number(raw);
  }
  return 20;
}

function savePreferredDuration(minutes: number): void {
  try {
    window.localStorage.setItem(DURATION_PREFERENCE_KEY, String(minutes));
  } catch {
    preferenceFallback.set(DURATION_PREFERENCE_KEY, String(minutes));
  }
}

function getStorage(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void; clear: () => void } {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // Fall back to memory
  }
  return {
    getItem: (k: string) => memoryFallback.get(k) ?? null,
    setItem: (k: string, v: string) => { memoryFallback.set(k, v); },
    removeItem: (k: string) => { memoryFallback.delete(k); },
    clear: () => { memoryFallback.clear(); },
  };
}

export function loadStoredTimer(problemKey: string): StoredTimerState {
  try {
    const storage = getStorage();
    const raw = storage.getItem(getTimerStorageKey(problemKey));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.elapsedMs === 'number') {
        return parsed;
      }
    }
  } catch {
    // Ignore storage parse errors
  }
  return {
    problemKey,
    elapsedMs: 0,
    runningSince: null,
    mode: 'countdown',
    countdownLimitMinutes: getPreferredDuration(),
    alertAcknowledged: false,
  };
}

export function saveStoredTimer(state: StoredTimerState): void {
  try {
    const storage = getStorage();
    storage.setItem(getTimerStorageKey(state.problemKey), JSON.stringify(state));
  } catch {
    // Ignore storage write errors
  }
}

export function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    const hh = String(hours).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

interface Props {
  problemKey: string;
  handle?: string;
  onTimeUpdate?: (elapsedMs: number) => void;
}

export const ProblemTimerWidget: React.FC<Props> = ({ problemKey, handle, onTimeUpdate }) => {
  const [timer, setTimer] = useState<StoredTimerState>(() => loadStoredTimer(problemKey));
  const [now, setNow] = useState<number>(Date.now());
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('20');
  const [confirmReset, setConfirmReset] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const settingsId = useId();
  const customId = useId();
  const settingsRef = useRef<HTMLDivElement>(null);
  const previousTimeUp = useRef(false);

  const recordSessionAction = async (action: SessionAction) => {
    if (!handle) return;
    const current = await practiceSession(handle, problemKey);
    if (!current || current.stopped) {
      if (action === 'pause' || action === 'assistance' || action === 'stop') {
        await practiceSession(handle, problemKey, { id: crypto.randomUUID(), action: 'start' });
      } else if (action === 'resume') {
        await practiceSession(handle, problemKey, { id: crypto.randomUUID(), action: 'start' });
        return;
      }
    }
    const refreshed = await practiceSession(handle, problemKey);
    if (action === 'pause' && refreshed?.runningSince === null) return;
    if (action === 'resume' && refreshed?.runningSince !== null) return;
    await practiceSession(handle, problemKey, { id: crypto.randomUUID(), action });
  };

  const syncSession = (action: SessionAction) => {
    void recordSessionAction(action).catch(() => setAnnouncement('Timer session could not be saved.'));
  };

  // Keep a ref to the latest state so unmount / background interval always writes current state
  const stateRef = useRef(timer);
  stateRef.current = timer;

  useEffect(() => {
    // When problemKey changes, reload state
    const loaded = loadStoredTimer(problemKey);
    setTimer(loaded);
    setSettingsOpen(false);
    setCustomOpen(false);
    setConfirmReset(false);
    previousTimeUp.current = false;
  }, [problemKey]);

  useEffect(() => {
    const syncSavedOutcome = (event: Event) => {
      if ((event as CustomEvent<{ problemKey: string }>).detail?.problemKey !== problemKey) return;
      const updated = loadStoredTimer(problemKey);
      stateRef.current = updated;
      setTimer(updated);
      setNow(Date.now());
    };
    window.addEventListener('cfchart:timer-saved-outcome', syncSavedOutcome);
    return () => window.removeEventListener('cfchart:timer-saved-outcome', syncSavedOutcome);
  }, [problemKey]);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!event.composedPath().includes(settingsRef.current as EventTarget)) {
        setSettingsOpen(false);
        setConfirmReset(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [settingsOpen]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
      if (stateRef.current.runningSince !== null) {
        const currentElapsed =
          stateRef.current.elapsedMs + (Date.now() - stateRef.current.runningSince);
        onTimeUpdate?.(currentElapsed);
      }
    }, 500);

    return () => {
      window.clearInterval(interval);
      saveStoredTimer(stateRef.current);
    };
  }, [onTimeUpdate]);

  const isRunning = timer.runningSince !== null;
  const currentElapsedMs =
    timer.elapsedMs + (isRunning ? Math.max(0, now - timer.runningSince!) : 0);

  const countdownLimitMs = timer.countdownLimitMinutes * 60 * 1000;
  const countdownRemainingMs = Math.max(0, countdownLimitMs - currentElapsedMs);
  const isTimeUp = timer.mode === 'countdown' && currentElapsedMs >= countdownLimitMs;
  const shownMs = timer.mode === 'countdown' ? countdownRemainingMs : currentElapsedMs;
  const progress = timer.mode === 'countdown'
    ? Math.min(100, Math.max(0, Math.round(currentElapsedMs / countdownLimitMs * 100)))
    : 0;
  const status = isTimeUp ? 'Over time' : isRunning ? 'Running' : currentElapsedMs > 0 ? 'Paused' : 'Ready';
  const primaryLabel = isRunning ? 'Pause' : currentElapsedMs > 0 ? 'Resume' : 'Start';

  useEffect(() => {
    if (isTimeUp && !previousTimeUp.current && !timer.alertAcknowledged) {
      setAnnouncement('Time limit reached');
    }
    previousTimeUp.current = isTimeUp;
  }, [isTimeUp, timer.alertAcknowledged]);

  const handleStart = () => {
    syncSession(timer.elapsedMs > 0 ? 'resume' : 'start');
    const updated: StoredTimerState = {
      ...timer,
      runningSince: Date.now(),
    };
    setTimer(updated);
    saveStoredTimer(updated);
    setAnnouncement(currentElapsedMs > 0 ? 'Timer resumed' : 'Timer started');
  };

  const handlePause = () => {
    if (timer.runningSince === null) return;
    syncSession('pause');
    const added = Date.now() - timer.runningSince;
    const updated: StoredTimerState = {
      ...timer,
      elapsedMs: timer.elapsedMs + added,
      runningSince: null,
    };
    setTimer(updated);
    saveStoredTimer(updated);
    setAnnouncement('Timer paused');
  };

  const handleReset = () => {
    if (currentElapsedMs > 0) {
      void (async () => {
        try {
          if (timer.runningSince !== null) await recordSessionAction('pause');
          await recordSessionAction('stop');
        } catch {
          setAnnouncement('Timer session could not be saved.');
        }
      })();
    }
    const updated: StoredTimerState = {
      ...timer,
      elapsedMs: 0,
      runningSince: null,
      alertAcknowledged: false,
    };
    setTimer(updated);
    saveStoredTimer(updated);
    setConfirmReset(false);
    setSettingsOpen(false);
    setAnnouncement('Timer reset');
  };

  const handleModeChange = (mode: 'stopwatch' | 'countdown') => {
    const updated: StoredTimerState = {
      ...timer,
      mode,
    };
    setTimer(updated);
    saveStoredTimer(updated);
    setAnnouncement(`${mode === 'countdown' ? 'Countdown' : 'Stopwatch'} selected`);
  };

  const handleLimitChange = (minutes: number) => {
    const updated: StoredTimerState = {
      ...timer,
      countdownLimitMinutes: minutes,
      alertAcknowledged: false,
    };
    setTimer(updated);
    saveStoredTimer(updated);
    savePreferredDuration(minutes);
    setCustomMinutes(String(minutes));
    setAnnouncement(`Duration set to ${minutes} minutes`);
  };

  const handleAddMinutes = (extraMinutes: number) => {
    const updated: StoredTimerState = {
      ...timer,
      countdownLimitMinutes: timer.countdownLimitMinutes + extraMinutes,
      alertAcknowledged: false,
    };
    setTimer(updated);
    saveStoredTimer(updated);
    setAnnouncement(`${extraMinutes} minutes added`);
  };

  const handleContinue = () => {
    const updated = { ...timer, alertAcknowledged: true };
    setTimer(updated);
    saveStoredTimer(updated);
    setAnnouncement('Time limit notice dismissed');
  };

  const primaryButton = (
    <button
      type="button"
      className="cf-timer-primary"
      onClick={isRunning ? handlePause : handleStart}
      data-testid={isRunning ? 'timer-pause-btn' : 'timer-start-btn'}
    >
      {primaryLabel}
    </button>
  );

  return (
    <div className={`cf-timer-card${collapsed ? ' is-collapsed' : ''}`} aria-label="Practice timer" data-testid="problem-timer-widget">
      <div className="cf-timer-header">
        <span className="cf-timer-heading">Practice timer</span>
        <div className="cf-timer-header-actions">
          {!collapsed && <div className="cf-timer-settings-wrap" ref={settingsRef} onKeyDown={(event) => {
            if (event.key === 'Escape') { setSettingsOpen(false); setConfirmReset(false); }
          }}>
            <button type="button" className="cf-timer-icon-btn" aria-label="Timer settings" aria-expanded={settingsOpen} aria-controls={settingsId} onClick={() => setSettingsOpen(!settingsOpen)}>···</button>
            {settingsOpen && <div className="cf-timer-settings" id={settingsId} aria-label="Timer settings">
              <div className="cf-timer-setting-label">Mode</div>
              <div className="cf-timer-choice-row" role="group" aria-label="Timer mode">
                {(['countdown', 'stopwatch'] as const).map(mode => <button key={mode} type="button" aria-pressed={timer.mode === mode} onClick={() => handleModeChange(mode)}>{mode === 'countdown' ? 'Countdown' : 'Stopwatch'}</button>)}
              </div>
              {timer.mode === 'countdown' && <>
                <div className="cf-timer-setting-label">Duration</div>
                <div className="cf-timer-choice-row" role="group" aria-label="Countdown duration">
                  {[15, 20, 30, 45].map(minutes => <button key={minutes} type="button" aria-pressed={timer.countdownLimitMinutes === minutes} onClick={() => handleLimitChange(minutes)}>{minutes} min</button>)}
                </div>
                <button type="button" className="cf-timer-text-btn" aria-expanded={customOpen} onClick={() => { setCustomMinutes(String(timer.countdownLimitMinutes)); setCustomOpen(!customOpen); }}>Custom duration</button>
                {customOpen && <form className="cf-timer-custom" onSubmit={event => {
                  event.preventDefault();
                  const minutes = Number(customMinutes);
                  if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440) { handleLimitChange(minutes); setCustomOpen(false); }
                }}>
                  <label htmlFor={customId}>Minutes</label>
                  <input id={customId} type="number" min="1" max="1440" required value={customMinutes} onChange={event => setCustomMinutes(event.target.value)} />
                  <button type="submit">Apply</button>
                </form>}
              </>}
              <div className="cf-timer-settings-divider" />
              {confirmReset ? <div className="cf-timer-reset-confirm">
                <span>Reset elapsed time?</span>
                <button type="button" onClick={handleReset} data-testid="timer-confirm-reset-btn">Reset</button>
                <button type="button" onClick={() => setConfirmReset(false)}>Cancel</button>
              </div> : <button type="button" className="cf-timer-text-btn" onClick={() => currentElapsedMs > 60_000 ? setConfirmReset(true) : handleReset()} data-testid="timer-reset-btn">Reset timer</button>}
            </div>}
          </div>}
          <button type="button" className="cf-timer-icon-btn cf-timer-collapse" aria-label={collapsed ? 'Expand timer' : 'Collapse timer'} aria-expanded={!collapsed} onClick={() => { setCollapsed(!collapsed); setSettingsOpen(false); }}>{collapsed ? '⌄' : '⌃'}</button>
        </div>
      </div>
      <div className="cf-timer-main">
        <div className="cf-timer-clock">
          <span className="cf-timer-digits" data-testid="timer-digits" role="timer" aria-label={timer.mode === 'countdown' ? `${Math.floor(shownMs / 60_000)} minutes ${Math.floor(shownMs % 60_000 / 1000)} seconds remaining` : `${Math.floor(shownMs / 60_000)} minutes ${Math.floor(shownMs % 60_000 / 1000)} seconds elapsed`}>{formatTime(shownMs)}</span>
          <span className="cf-timer-clock-caption">{timer.mode === 'countdown' ? `Countdown · ${timer.countdownLimitMinutes} min` : 'Stopwatch'} <span aria-hidden="true">·</span> {status}</span>
        </div>
        {primaryButton}
      </div>
      {!collapsed && timer.mode === 'countdown' && <div className="cf-timer-progress" role="progressbar" aria-label="Countdown elapsed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`${progress}% of time elapsed`}><span style={{ width: `${progress}%` }} /></div>}
      {!collapsed && isTimeUp && !timer.alertAcknowledged && <div className="cf-timer-alert-box" data-testid="timer-alert-box">
        <span><strong>Time limit reached.</strong> Take a hint or continue when you're ready.</span>
        <div className="cf-timer-alert-actions">
          <button type="button" onClick={() => handleAddMinutes(5)} className="cf-timer-text-btn cf-timer-btn-snooze">+5 min</button>
          <button type="button" onClick={handleContinue} className="cf-timer-text-btn">Continue</button>
        </div>
      </div>}
      <span className="cf-timer-sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
    </div>
  );
};
