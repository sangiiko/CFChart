// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProblemTimerWidget,
  formatTime,
  loadStoredTimer,
  saveStoredTimer,
  getTimerStorageKey,
} from '../ProblemTimerWidget';

const store = new Map<string, string>();
const fakeStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, val: string) => { store.set(key, String(val)); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
};

Object.defineProperty(window, 'sessionStorage', {
  value: fakeStorage,
  writable: true,
});

describe('ProblemTimerWidget utility functions', () => {
  beforeEach(() => {
    fakeStorage.clear();
  });

  it('formats milliseconds to MM:SS and HH:MM:SS correctly', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(5_000)).toBe('00:05');
    expect(formatTime(65_000)).toBe('01:05');
    expect(formatTime(600_000)).toBe('10:00');
    expect(formatTime(3_600_000)).toBe('01:00:00');
    expect(formatTime(3_665_000)).toBe('01:01:05');
  });

  it('loads default state when no storage exists', () => {
    const state = loadStoredTimer('1234-A');
    expect(state.problemKey).toBe('1234-A');
    expect(state.elapsedMs).toBe(0);
    expect(state.runningSince).toBeNull();
    expect(state.mode).toBe('countdown');
    expect(state.countdownLimitMinutes).toBe(20);
  });

  it('saves and reloads state from storage', () => {
    saveStoredTimer({
      problemKey: '1234-B',
      elapsedMs: 15_000,
      runningSince: 1_700_000_000,
      mode: 'stopwatch',
      countdownLimitMinutes: 30,
      alertAcknowledged: false,
    });
    const loaded = loadStoredTimer('1234-B');
    expect(loaded.elapsedMs).toBe(15_000);
    expect(loaded.mode).toBe('stopwatch');
    expect(loaded.countdownLimitMinutes).toBe(30);
  });
});

describe('ProblemTimerWidget component rendering', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    fakeStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
  });

  it('renders countdown timer initially with 20 minutes target', async () => {
    await act(async () => {
      root!.render(<ProblemTimerWidget problemKey="100-A" />);
    });
    expect(container!.textContent).toContain('Practice timer');
    expect(container!.textContent).toContain('Countdown · 20 min');
    expect(container!.textContent).toContain('20:00');
    expect(container!.querySelector('[data-testid="timer-start-btn"]')).not.toBeNull();
  });

  it('starts, pauses, and updates elapsed time', async () => {
    vi.useFakeTimers();
    const onTimeUpdate = vi.fn();

    await act(async () => {
      root!.render(<ProblemTimerWidget problemKey="100-B" onTimeUpdate={onTimeUpdate} />);
    });

    const startBtn = container!.querySelector('[data-testid="timer-start-btn"]') as HTMLButtonElement;
    await act(async () => {
      startBtn.click();
    });

    expect(container!.querySelector('[data-testid="timer-pause-btn"]')).not.toBeNull();

    // Advance 5 seconds
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    const pauseBtn = container!.querySelector('[data-testid="timer-pause-btn"]') as HTMLButtonElement;
    await act(async () => {
      pauseBtn.click();
    });

    expect(container!.querySelector('[data-testid="timer-start-btn"]')).not.toBeNull();

    const stored = loadStoredTimer('100-B');
    expect(stored.runningSince).toBeNull();
    expect(stored.elapsedMs).toBeGreaterThanOrEqual(5000);

    vi.useRealTimers();
  });

  it('switches between Countdown and Stopwatch mode', async () => {
    await act(async () => {
      root!.render(<ProblemTimerWidget problemKey="100-C" />);
    });

    expect(container!.textContent).toContain('Countdown · 20 min');
    const settingsBtn = container!.querySelector('[aria-label="Timer settings"]') as HTMLButtonElement;
    await act(async () => {
      settingsBtn.click();
    });
    expect(settingsBtn.getAttribute('aria-expanded')).toBe('true');
    const stopwatchBtn = container!.querySelector('[aria-label="Timer mode"] button:last-child') as HTMLButtonElement;
    await act(async () => stopwatchBtn.click());

    expect(container!.textContent).toContain('Stopwatch');
    expect(container!.querySelector('[data-testid="timer-digits"]')?.textContent).toBe('00:00');

    const countdownBtn = container!.querySelector('[aria-label="Timer mode"] button:first-child') as HTMLButtonElement;
    await act(async () => {
      countdownBtn.click();
    });
    expect(container!.textContent).toContain('Countdown · 20 min');
    const durationBtn = Array.from(container!.querySelectorAll('[aria-label="Countdown duration"] button')).find(button => button.textContent === '30 min') as HTMLButtonElement;
    await act(async () => durationBtn.click());
    expect(container!.querySelector('[data-testid="timer-digits"]')?.textContent).toBe('30:00');
    expect(loadStoredTimer('100-C').countdownLimitMinutes).toBe(30);
  });

  it('shows thinking limit alert when countdown reaches zero', async () => {
    fakeStorage.setItem(
      getTimerStorageKey('100-D'),
      JSON.stringify({
        problemKey: '100-D',
        elapsedMs: 15 * 60 * 1000 + 1000,
        runningSince: null,
        mode: 'countdown',
        countdownLimitMinutes: 15,
        alertAcknowledged: false,
      })
    );

    await act(async () => {
      root!.render(<ProblemTimerWidget problemKey="100-D" />);
    });

    expect(container!.querySelector('[data-testid="timer-alert-box"]')).not.toBeNull();
    expect(container!.textContent).toContain('Time limit reached.');

    // Snooze 5 minutes
    const snoozeBtn = container!.querySelector('.cf-timer-btn-snooze') as HTMLButtonElement;
    await act(async () => {
      snoozeBtn.click();
    });

    expect(container!.querySelector('[data-testid="timer-alert-box"]')).toBeNull();
    expect(container!.querySelector('[data-testid="timer-digits"]')?.textContent).toBe('04:59');
  });

  it('keeps the clock and primary action visible when collapsed', async () => {
    await act(async () => root!.render(<ProblemTimerWidget problemKey="100-E" />));
    const collapseBtn = container!.querySelector('[aria-label="Collapse timer"]') as HTMLButtonElement;
    await act(async () => collapseBtn.click());
    expect(container!.querySelector('.cf-timer-card')?.classList.contains('is-collapsed')).toBe(true);
    expect(container!.querySelector('[data-testid="timer-digits"]')?.textContent).toBe('20:00');
    expect(container!.querySelector('[data-testid="timer-start-btn"]')).not.toBeNull();
    expect(container!.querySelector('[aria-label="Timer settings"]')).toBeNull();
    await act(async () => (container!.querySelector('[data-testid="timer-start-btn"]') as HTMLButtonElement).click());
    expect(container!.querySelector('[data-testid="timer-pause-btn"]')).not.toBeNull();
  });

  it('confirms reset after substantial elapsed time', async () => {
    saveStoredTimer({ problemKey: '100-F', elapsedMs: 90_000, runningSince: null, mode: 'stopwatch', countdownLimitMinutes: 20, alertAcknowledged: false });
    await act(async () => root!.render(<ProblemTimerWidget problemKey="100-F" />));
    await act(async () => (container!.querySelector('[aria-label="Timer settings"]') as HTMLButtonElement).click());
    await act(async () => (container!.querySelector('[data-testid="timer-reset-btn"]') as HTMLButtonElement).click());
    expect(container!.textContent).toContain('Reset elapsed time?');
    expect(loadStoredTimer('100-F').elapsedMs).toBe(90_000);
    await act(async () => (container!.querySelector('[data-testid="timer-confirm-reset-btn"]') as HTMLButtonElement).click());
    expect(loadStoredTimer('100-F').elapsedMs).toBe(0);
    expect(container!.querySelector('[data-testid="timer-digits"]')?.textContent).toBe('00:00');
  });

  it('restores elapsed time and keeps a dismissed expiry notice dismissed', async () => {
    saveStoredTimer({ problemKey: '100-G', elapsedMs: 21 * 60_000, runningSince: null, mode: 'countdown', countdownLimitMinutes: 20, alertAcknowledged: false });
    await act(async () => root!.render(<ProblemTimerWidget problemKey="100-G" />));
    expect(container!.querySelector('[data-testid="timer-alert-box"]')).not.toBeNull();
    expect(container!.querySelector('.cf-timer-progress')?.getAttribute('aria-valuenow')).toBe('100');
    const continueBtn = Array.from(container!.querySelectorAll('.cf-timer-alert-actions button')).find(button => button.textContent === 'Continue') as HTMLButtonElement;
    await act(async () => continueBtn.click());
    expect(container!.querySelector('[data-testid="timer-alert-box"]')).toBeNull();
    expect(loadStoredTimer('100-G').alertAcknowledged).toBe(true);
    await act(async () => root!.render(<ProblemTimerWidget problemKey="100-G" />));
    expect(container!.querySelector('[data-testid="timer-alert-box"]')).toBeNull();
  });
});
