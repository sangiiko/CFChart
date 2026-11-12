// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const client = vi.hoisted(() => ({ recordPracticeFeedback: vi.fn() }));
vi.mock('../../../services/extensionClient', () => client);
import { ProblemVerdictBar } from '../ProblemVerdictBar';
import { ProblemTimerWidget, loadStoredTimer, saveStoredTimer } from '../ProblemTimerWidget';

describe('problem outcome and timer handoff', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    client.recordPracticeFeedback.mockReset().mockResolvedValue(undefined);
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    saveStoredTimer({ problemKey: '200-A', elapsedMs: 60_000, runningSince: Date.now() - 30_000, mode: 'countdown', countdownLimitMinutes: 20, alertAcknowledged: false });
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it('records elapsed time and pauses the visible timer after a successful save', async () => {
    await act(async () => root.render(<><ProblemTimerWidget problemKey="200-A" /><ProblemVerdictBar handle="alice" contestId={200} index="A" /></>));
    expect(container.querySelector('[data-testid="timer-pause-btn"]')).not.toBeNull();
    const solved = [...container.querySelectorAll('.cf-verdict-btn')].find(button => button.textContent === 'Solved') as HTMLButtonElement;
    await act(async () => solved.click());
    expect(client.recordPracticeFeedback).toHaveBeenCalledWith('alice', expect.objectContaining({ problemKey: '200-A', outcome: 'independent', minutes: expect.any(Number) }));
    expect(loadStoredTimer('200-A').runningSince).toBeNull();
    expect(container.querySelector('[data-testid="timer-pause-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="timer-start-btn"]')).not.toBeNull();
    expect(solved.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Saved');
  });

  it('keeps the timer running if saving the outcome fails', async () => {
    client.recordPracticeFeedback.mockRejectedValueOnce(new Error('Storage unavailable'));
    await act(async () => root.render(<><ProblemTimerWidget problemKey="200-A" /><ProblemVerdictBar handle="alice" contestId={200} index="A" /></>));
    const assisted = [...container.querySelectorAll('.cf-verdict-btn')].find(button => button.textContent === 'Solved with help') as HTMLButtonElement;
    await act(async () => assisted.click());
    expect(loadStoredTimer('200-A').runningSince).not.toBeNull();
    expect(container.querySelector('[data-testid="timer-pause-btn"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not save');
  });
});
