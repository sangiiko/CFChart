// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecommendedProblem } from '../../types/codeforces';
const client = vi.hoisted(() => ({ practiceSession: vi.fn(async () => null), recordPracticeFeedback: vi.fn(), exportPracticeData: vi.fn(), clearPracticeData: vi.fn(), subscribeToChanges: vi.fn(() => () => {}) }));
vi.mock('../../services/extensionClient', () => client);
import { PracticeRecommendations } from '../PracticeRecommendations';
const problem: RecommendedProblem = { contestId: 10, index: 'A', name: 'Example', rating: 1400, tags: [], slot: 'core',
  slotLabel: 'Core practice', pSolve: null, plannedMinutes: 30, reasons: ['Within your practice range.'], qualityScore: 1,
  url: 'https://codeforces.com/problemset/problem/10/A' };
let root: Root;
let container: HTMLDivElement;
const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent === text)!;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<PracticeRecommendations handle="alice" recommendations={[problem]} budget={60} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('practice feedback UI', () => {
  it('renders correct links and allowances without a fake percentage, and records unknown time honestly', async () => {
    expect(container.querySelector('a')?.href).toBe(problem.url);
    expect(container.textContent).toContain('Core practice');
    expect(container.textContent).toContain('1400');
    expect(container.textContent).not.toContain('Practice plan');
    expect(container.textContent).not.toContain('50%');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(client.recordPracticeFeedback).toHaveBeenCalledWith('alice', expect.objectContaining({ outcome: 'independent', problemKey: '10-A' }));
    expect(client.recordPracticeFeedback.mock.calls[0][1]).not.toHaveProperty('minutes');
    expect(container.textContent).toContain('Result saved');
  });
  it('records an assisted outcome and preserves errors for retry', async () => {
    const select = container.querySelector('select')!;
    await act(async () => { select.value = 'assisted'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    client.recordPracticeFeedback.mockRejectedValueOnce(new Error('Storage unavailable'));
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(client.recordPracticeFeedback.mock.calls[0][1].outcome).toBe('assisted');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Storage unavailable');
    expect(button('Save result').disabled).toBe(false);
  });
  it('does not render unnecessary export, delete or active minutes inputs', () => {
    expect(container.textContent).not.toContain('Delete practice data');
    expect(container.textContent).not.toContain('Export practice data');
    expect(container.textContent).not.toContain('active minutes');
    expect(container.textContent).not.toContain('Why this problem');
    expect(container.textContent).not.toContain('Practice plan');
    expect(container.textContent).not.toContain('Up to 60 minutes today');
  });
});
