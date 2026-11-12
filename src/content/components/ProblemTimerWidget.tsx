import React, { useEffect, useState, useRef, useId } from 'react';

export interface StoredTimerState {
  problemKey: string;
  elapsedMs: number;
  runningSince: number | null;
  mode: 'stopwatch' | 'countdown';
  countdownLimitMinutes: number;
  alertAcknowledged: boolean;
}

export const STORAGE_PREFIX = 'cfchart_timer_';

export function getTimerStorageKey(problemKey: string): string {
  return `${STORAGE_PREFIX}${problemKey}`;
}

const memoryFallback = new Map<string, string>();

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
    countdownLimitMinutes: 20,
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
  onTimeUpdate?: (elapsedMs: number) => void;
}

export const ProblemTimerWidget: React.FC<Props> = ({ problemKey, onTimeUpdate }) => {
  const [timer, setTimer] = useState<StoredTimerState>(() => loadStoredTimer(problemKey));
  const [now, setNow] = useState<number>(Date.now());
  const [collapsed, setCollapsed] = useState(false);
  const countdownSelectId = useId();

  // Keep a ref to the latest state so unmount / background interval always writes current state
  const stateRef = useRef(timer);
  stateRef.current = timer;

  useEffect(() => {
    // When problemKey changes, reload state
    const loaded = loadStoredTimer(problemKey);
    setTimer(loaded);
  }, [problemKey]);

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
    timer.elapsedMs + (isRunning && timer.runningSince ? Math.max(0, now - timer.runningSince) : 0);

  const countdownLimitMs = timer.countdownLimitMinutes * 60 * 1000;
  const countdownRemainingMs = Math.max(0, countdownLimitMs - currentElapsedMs);
  const isTimeUp = timer.mode === 'countdown' && currentElapsedMs >= countdownLimitMs;

  const handleStart = () => {
    const updated: StoredTimerState = {
      ...timer,
      runningSince: Date.now(),
    };
    setTimer(updated);
    saveStoredTimer(updated);
  };

  const handlePause = () => {
    if (!timer.runningSince) return;
    const added = Date.now() - timer.runningSince;
    const updated: StoredTimerState = {
      ...timer,
      elapsedMs: timer.elapsedMs + added,
      runningSince: null,
    };
    setTimer(updated);
    saveStoredTimer(updated);
  };

  const handleReset = () => {
    const updated: StoredTimerState = {
      ...timer,
      elapsedMs: 0,
      runningSince: null,
      alertAcknowledged: false,
    };
    setTimer(updated);
    saveStoredTimer(updated);
  };

  const handleModeChange = (mode: 'stopwatch' | 'countdown') => {
    const updated: StoredTimerState = {
      ...timer,
      mode,
    };
    setTimer(updated);
    saveStoredTimer(updated);
  };

  const handleLimitChange = (minutes: number) => {
    const updated: StoredTimerState = {
      ...timer,
      countdownLimitMinutes: minutes,
      alertAcknowledged: false,
    };
    setTimer(updated);
    saveStoredTimer(updated);
  };

  const handleAddMinutes = (extraMinutes: number) => {
    const updated: StoredTimerState = {
      ...timer,
      countdownLimitMinutes: timer.countdownLimitMinutes + extraMinutes,
      alertAcknowledged: false,
    };
    setTimer(updated);
    saveStoredTimer(updated);
  };

  return (
    <div
      className={`cf-timer-card ${isTimeUp ? 'is-alarm' : ''} ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="Practice timer and thinking countdown"
      data-testid="problem-timer-widget"
    >
      <div className="cf-timer-header">
        <div className="cf-timer-title-group">
          <span className="cf-timer-icon" aria-hidden="true">⏱️</span>
          <span className="cf-timer-heading">
            {timer.mode === 'countdown' ? 'Thinking Countdown' : 'Practice Stopwatch'}
          </span>
          <span className={`cf-timer-badge ${isRunning ? 'is-running' : 'is-paused'}`}>
            {isRunning ? 'Running' : 'Paused'}
          </span>
        </div>

        <div className="cf-timer-controls-right">
          <button
            type="button"
            className="cf-timer-toggle-btn"
            onClick={() => handleModeChange(timer.mode === 'countdown' ? 'stopwatch' : 'countdown')}
            title="Switch between Thinking Countdown and Stopwatch"
          >
            {timer.mode === 'countdown' ? 'Switch to Stopwatch' : 'Switch to Countdown'}
          </button>
          <button
            type="button"
            className="cf-timer-icon-btn"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expand timer' : 'Collapse timer'}
            aria-label={collapsed ? 'Expand timer' : 'Collapse timer'}
          >
            {collapsed ? '▼' : '▲'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="cf-timer-body">
          <div className="cf-timer-display-row">
            <div className="cf-timer-digits" data-testid="timer-digits">
              {timer.mode === 'countdown'
                ? formatTime(countdownRemainingMs)
                : formatTime(currentElapsedMs)}
            </div>

            <div className="cf-timer-actions">
              {!isRunning ? (
                <button
                  type="button"
                  className="cf-timer-btn cf-timer-btn-primary"
                  onClick={handleStart}
                  data-testid="timer-start-btn"
                >
                  ▶ Start
                </button>
              ) : (
                <button
                  type="button"
                  className="cf-timer-btn cf-timer-btn-pause"
                  onClick={handlePause}
                  data-testid="timer-pause-btn"
                >
                  ⏸ Pause
                </button>
              )}
              <button
                type="button"
                className="cf-timer-btn cf-timer-btn-secondary"
                onClick={handleReset}
                data-testid="timer-reset-btn"
              >
                ↺ Reset
              </button>
            </div>
          </div>

          {timer.mode === 'countdown' && (
            <div className="cf-timer-options">
              <span className="cf-timer-label">Thinking limit:</span>
              <div className="cf-timer-presets" role="group" aria-label="Quick preset limits">
                {[15, 20, 30, 45].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    className={`cf-timer-pill ${
                      timer.countdownLimitMinutes === mins ? 'is-active' : ''
                    }`}
                    onClick={() => handleLimitChange(mins)}
                  >
                    {mins}m
                  </button>
                ))}
              </div>
              <label htmlFor={countdownSelectId} className="cf-timer-custom-label">
                Custom:
              </label>
              <select
                id={countdownSelectId}
                className="cf-timer-select"
                value={timer.countdownLimitMinutes}
                onChange={(e) => handleLimitChange(Number(e.target.value))}
                aria-label="Thinking limit dropdown"
              >
                {[10, 15, 20, 25, 30, 40, 45, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} mins
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="cf-timer-footer-info">
            <span>Total elapsed: <strong>{formatTime(currentElapsedMs)}</strong></span>
            {timer.mode === 'countdown' && (
              <span>Target: <strong>{timer.countdownLimitMinutes} mins</strong></span>
            )}
          </div>

          {isTimeUp && (
            <div className="cf-timer-alert-box" role="alert" data-testid="timer-alert-box">
              <div className="cf-timer-alert-title">
                ⚠️ Hết thời gian suy nghĩ độc lập ({timer.countdownLimitMinutes} phút)!
              </div>
              <div className="cf-timer-alert-msg">
                Bạn đã suy nghĩ hết giới hạn định trước. Để tối ưu hiệu quả luyện tập và không bị sa đà, hãy cân nhắc đọc <strong>Hint</strong>, xem <strong>Editorial</strong> hoặc chuyển hướng tiếp cận bài toán.
              </div>
              <div className="cf-timer-alert-actions">
                <button
                  type="button"
                  className="cf-timer-btn cf-timer-btn-snooze"
                  onClick={() => handleAddMinutes(5)}
                >
                  +5 phút nữa
                </button>
                <button
                  type="button"
                  className="cf-timer-btn cf-timer-btn-secondary"
                  onClick={() => handleModeChange('stopwatch')}
                >
                  Tiếp tục với Stopwatch
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
