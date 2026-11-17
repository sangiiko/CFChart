// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const peek = vi.hoisted(() => ({ loadPeers: vi.fn() }));
vi.mock('../../codePeek', async () => {
  const actual = await vi.importActual<typeof import('../../codePeek')>('../../codePeek');
  return { ...actual, loadPeers: peek.loadPeers };
});
import { CodePeekChip } from '../CodePeekChip';
import { CodePeekError, type Peer } from '../../codePeek';

const peer = (handle: string, lines: number): Peer => ({
  submissionId: handle.length, handle, language: 'C++20 (GCC 13-64)', ms: 31, partyMembers: 1, lines,
  source: `int main() { /* ${handle} */ }`,
});

describe('fastest solutions chip', () => {
  let root: Root;
  let container: HTMLDivElement;
  const click = async (element: Element | null) => { await act(async () => (element as HTMLElement).click()); await act(async () => { await Promise.resolve(); }); };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    peek.loadPeers.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it('loads peers only after the chip is opened', async () => {
    peek.loadPeers.mockResolvedValue({ peers: [peer('tourist', 42)], scanned: 50, family: 'cpp' });
    await act(async () => root.render(<CodePeekChip contestId={2000} index="B" handle="me" language="C++17 (GCC 7-32)" />));
    expect(peek.loadPeers).not.toHaveBeenCalled();
    await click(container.querySelector('.cf-codepeek-chip'));
    expect(peek.loadPeers).toHaveBeenCalledWith(2000, 'B', 'me', expect.objectContaining({ language: 'C++17 (GCC 7-32)' }));
    expect(container.textContent).toContain('50 fastest accepted · cpp · you excluded');
    expect(container.textContent).toContain('42 lines · 31 ms · C++20 (GCC 13-64)');
  });

  it('shows source only for the row the reader opens', async () => {
    peek.loadPeers.mockResolvedValue({ peers: [peer('tourist', 42), peer('Petr', 51)], scanned: 50, family: 'cpp' });
    await act(async () => root.render(<CodePeekChip contestId={2000} index="B" handle="me" />));
    await click(container.querySelector('.cf-codepeek-chip'));
    expect(container.querySelectorAll('.cf-codepeek-source')).toHaveLength(0);
    const heads = container.querySelectorAll('.cf-codepeek-head');
    await click(heads[1]);
    const sources = container.querySelectorAll('.cf-codepeek-source');
    expect(sources).toHaveLength(1);
    expect(sources[0].textContent).toContain('Petr');
    expect(container.querySelectorAll('.cf-codepeek-head')[1].getAttribute('aria-expanded')).toBe('true');
  });

  it('reports a blocked request and offers a retry', async () => {
    peek.loadPeers.mockRejectedValueOnce(new CodePeekError('Codeforces blocked this request. Try again in a minute.', 'blocked'));
    peek.loadPeers.mockResolvedValueOnce({ peers: [peer('tourist', 42)], scanned: 50, family: 'cpp' });
    await act(async () => root.render(<CodePeekChip contestId={2000} index="B" handle="me" />));
    await click(container.querySelector('.cf-codepeek-chip'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('blocked this request');
    await click(container.querySelector('.cf-codepeek-note .cf-link'));
    expect(container.textContent).toContain('tourist');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
