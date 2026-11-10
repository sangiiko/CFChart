// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences, PracticeSnapshot, ProfileSnapshot } from '../../types/app';

const client = vi.hoisted(() => ({ getPreferences: vi.fn(), updatePreferences: vi.fn(), detectViewer: vi.fn(), getProfile: vi.fn(), getPractice: vi.fn(), subscribeToChanges: vi.fn() }));
vi.mock('../../services/extensionClient', () => client);
vi.mock('../content.css', () => ({ default: ':host{all:initial}' }));
import { startCFChart } from '../controller';

const defaults: Preferences = { personalHandle: 'myHandle', dailyTarget: 2, chartView: 'enhanced', predictionParams: { dailyProblems: 2, difficultyOffset: 150, horizonMonths: 6 } };
const snapshot: ProfileSnapshot = { handle: 'tourist', user: { handle: 'tourist', rating: 3800, maxRating: 4000 }, ratings: [{ handle: 'tourist', contestId: 1, contestName: 'Round #1', rank: 1, oldRating: 0, newRating: 3800, ratingUpdateTimeSeconds: 1700000000 }], updatedAt: Date.now() };
const practice: PracticeSnapshot = { handle: 'myHandle', submissions: [], recommendations: [], updatedAt: Date.now(), coverage: { complete: true, loaded: 0 }, progress: { dailyTarget: 2, todayCount: 0, isTodayTargetMet: false, todayProblems: [], currentStreak: 0, recentDays: [], lastUpdated: Date.now() } };
let dispose: (() => void) | undefined;
let saved: Preferences;
const nativeGraph = () => document.querySelector<HTMLElement>('.userRatingGraphHolder')!;
const shadow = (id: string) => document.getElementById(id)!.shadowRoot!;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
async function start() { await act(async () => { dispose = startCFChart(); }); await flush(); }

describe('in-page content integration', () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    history.replaceState({}, '', '/profile/tourist');
    document.body.innerHTML = '<div id="header"><div class="lang-chooser"><a href="/profile/myHandle">myHandle</a><a href="/logout">Logout</a></div></div><div id="pageContent"><div class="userbox">Profile</div><div class="userRatingGraphHolder" style="display:block"><div id="placeholder"></div></div></div>';
    saved = structuredClone(defaults);
    client.getPreferences.mockReset().mockImplementation(async () => saved);
    client.updatePreferences.mockReset().mockImplementation(async (partial: Partial<Preferences>) => { saved = { ...saved, ...partial }; return saved; });
    client.detectViewer.mockReset().mockImplementation(async () => saved);
    client.getProfile.mockReset().mockResolvedValue(snapshot);
    client.getPractice.mockReset().mockResolvedValue(practice);
    client.subscribeToChanges.mockReset().mockReturnValue(() => {});
  });
  afterEach(async () => { await act(async () => { dispose?.(); }); dispose = undefined; });
  it('renders inside ShadowRoots and keeps the tracked account separate from the viewed profile', async () => {
    await start();
    expect(document.querySelectorAll('[data-cfchart-host]')).toHaveLength(2);
    expect(shadow('cfchart-profile-host').textContent).toContain('tourist');
    expect(client.getProfile).toHaveBeenCalledWith('tourist', { force: false });
    expect(client.getPractice).toHaveBeenCalledWith('myHandle', { force: false, syncMore: false });
    expect(client.detectViewer).toHaveBeenCalledWith('myHandle');
    expect(client.updatePreferences).not.toHaveBeenCalled();
    expect(document.querySelector('svg')).toBeNull();
    expect(shadow('cfchart-profile-host').querySelector('svg')).not.toBeNull();
    expect(shadow('cfchart-profile-host').textContent).toContain('3800');
  });
  it('hides the native graph and restores it when the content script stops', async () => {
    await start(); expect(nativeGraph().style.display).toBe('none');
    await act(async () => { dispose?.(); });
    expect(nativeGraph().style.display).toBe('block');
    expect(document.querySelectorAll('[data-cfchart-host]')).toHaveLength(0);
  });
  it('keeps the original graph visible when the API cannot load the profile', async () => {
    client.getProfile.mockRejectedValue(new Error('Codeforces API is unavailable'));
    await start();
    expect(nativeGraph().style.display).toBe('block');
    expect(shadow('cfchart-profile-host').textContent).toContain('Codeforces API is unavailable');
  });
  it('never fabricates a rating for an unrated account', async () => {
    client.getProfile.mockResolvedValue({ ...snapshot, user: { handle: 'newUser' }, ratings: [] });
    await start();
    const text = shadow('cfchart-profile-host').textContent;
    expect(text).toContain('Unrated'); expect(text).toContain('No rated contests yet');
    expect(shadow('cfchart-profile-host').querySelector('svg')).toBeNull();
    expect(shadow('cfchart-profile-host').querySelector('input[type="checkbox"]')).toBeNull();
  });
  it('moves the panel to a delayed rating anchor and leaves the activity graph visible', async () => {
    nativeGraph().remove();
    document.querySelector('#pageContent')!.insertAdjacentHTML('beforeend', '<div class="roundbox"><div id="userActivityGraph">Activity</div></div>');
    await start();
    await act(async () => {
      document.querySelector('#pageContent')!.insertAdjacentHTML('beforeend', '<div class="userRatingGraphHolder"><div id="placeholder"></div></div>');
      await new Promise(resolve => setTimeout(resolve, 110));
    });
    expect(document.getElementById('cfchart-profile-host')!.nextElementSibling).toBe(nativeGraph());
    expect(nativeGraph().style.display).toBe('none');
    expect(document.querySelector<HTMLElement>('#userActivityGraph')!.parentElement!.style.display).not.toBe('none');
  });
  it('does not connect a visitor to arbitrary profile links when signed out', async () => {
    saved.personalHandle = null;
    document.querySelector('.lang-chooser')!.innerHTML = '<a href="/enter">Enter</a>';
    document.querySelector('#pageContent')!.insertAdjacentHTML('beforeend', '<a href="/profile/randomAuthor">randomAuthor</a>');
    await start();
    expect(client.detectViewer).not.toHaveBeenCalled();
    expect(client.getPractice).not.toHaveBeenCalledWith('randomAuthor');
    expect(shadow('cfchart-personal-host').textContent).toContain('Set up CFChart');
  });
  it('rechecks solved history explicitly and removes recommendations until full coverage returns', async () => {
    client.getPractice.mockImplementation(async (_handle: string, options?: { resetHistory?: boolean }) => options?.resetHistory ? { ...practice, coverage: { complete: false, loaded: 1000 }, recommendations: [] } : { ...practice, recommendations: [{ contestId: 1, index: 'A', name: 'Suggested fixture', rating: 1200, tags: [], type: 'warmup', slot: 'core', slotLabel: 'Core', pSolve: 0.5, reasons: ['Test reason'], qualityScore: 1, url: '/problemset/problem/1/A' }] });
    await start();
    await act(async () => { shadow('cfchart-personal-host').querySelector<HTMLButtonElement>('.cf-habit-pill')!.click(); });
    const personal = shadow('cfchart-personal-host');
    expect(personal.textContent).toContain('Suggested fixture');
    await act(async () => { Array.from(personal.querySelectorAll('button')).find(button => button.textContent === 'Recheck solved history')!.click(); });
    await flush();
    expect(client.getPractice).toHaveBeenCalledWith('myHandle', { force: true, syncMore: false, resetHistory: true });
    expect(personal.textContent).not.toContain('Suggested fixture');
    expect(personal.textContent).toContain('1,000 submissions synced');
  });
  it('remounts exactly once after reinjection', async () => {
    await start(); await start();
    expect(document.querySelectorAll('#cfchart-profile-host')).toHaveLength(1);
    expect(document.querySelectorAll('#cfchart-personal-host')).toHaveLength(1);
    expect(nativeGraph().style.display).toBe('none');
  });
});
