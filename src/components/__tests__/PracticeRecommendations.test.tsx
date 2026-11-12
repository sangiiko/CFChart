// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RecommendedProblem } from '../../types/codeforces';
import { PracticeRecommendations } from '../PracticeRecommendations';

const problem: RecommendedProblem = {
  contestId: 10, index: 'A', name: 'Example', rating: 1400, tags: [], slot: 'core',
  slotLabel: 'Core practice', pSolve: null, plannedMinutes: 30,
  reasons: ['Within your practice range.'], qualityScore: 1,
  url: 'https://codeforces.com/problemset/problem/10/A',
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('practice recommendation UI', () => {
  it('offers a problem without outcome controls before acceptance', async () => {
    await act(async () => root.render(<PracticeRecommendations recommendations={[problem]} />));
    expect(container.querySelector('a')?.href).toBe(problem.url);
    expect(container.textContent).toContain('Core practice');
    expect(container.textContent).toContain('Rating 1400');
    expect(container.textContent).toContain('Within your practice range.');
    expect(container.querySelector('form, select, .practice-task-outcome')).toBeNull();
    expect(container.textContent).not.toContain('Record outcome');
  });

  it('shows one next problem until more choices are requested', async () => {
    const another = { ...problem, contestId: 11, index: 'B', name: 'Another task' };
    await act(async () => root.render(<PracticeRecommendations recommendations={[problem, another]} />));
    expect(container.querySelectorAll('.practice-task')).toHaveLength(1);
    const more = [...container.querySelectorAll('button')].find(button => button.textContent === 'See 1 more choices')!;
    await act(async () => (more as HTMLButtonElement).click());
    expect(container.querySelectorAll('.practice-task')).toHaveLength(2);
    expect(container.querySelector('form, select, .practice-task-outcome')).toBeNull();
  });

  it('explains when no suitable task remains', async () => {
    await act(async () => root.render(<PracticeRecommendations recommendations={[]} />));
    expect(container.textContent).toContain('No tasks remain');
    expect(container.querySelector('.practice-task')).toBeNull();
  });
});
