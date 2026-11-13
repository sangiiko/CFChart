import { PracticeRecommendations } from '../components/PracticeRecommendations';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { getPreferences, getPractice, getProfile, subscribeToChanges, updatePreferences } from '../services/extensionClient';
import type { PracticeSnapshot, Preferences } from '../types/app';
import { getExtensionApi } from '../services/storage';
import './styles.css';

const message = (error: unknown) => error instanceof Error ? error.message : 'Could not connect to the extension. Reload it and try again.';

export function PracticeApp({ fullPage = false }: { fullPage?: boolean }) {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [practice, setPractice] = useState<PracticeSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const request = useRef(0);

  const load = useCallback(async (options: { force?: boolean; syncMore?: boolean } = {}) => {
    const id = ++request.current;
    setLoading(true);
    try {
      const prefs = await getPreferences();
      if (id !== request.current) return;
      setPreferences(prefs);
      if (!prefs.personalHandle) {
        setPractice(null);
      } else {
        const snapshot = await getPractice(prefs.personalHandle, options);
        if (id !== request.current) return;
        setPractice(snapshot);
      }
      setError('');
    } catch (reason) {
      if (id === request.current) setError(message(reason));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = subscribeToChanges(() => void load());
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { ++request.current; unsubscribe(); window.removeEventListener('focus', onFocus); clearInterval(timer); };
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const handle = String(form.get('handle') ?? '').trim();
    const dailyTarget = Number(form.get('target'));
    const practiceMinutes = Number(form.get('minutes'));
    setLoading(true);
    setError('');
    try {
      const user = handle ? (await getProfile(handle)).user : null;
      const prefs = await updatePreferences({ personalHandle: user?.handle ?? null, dailyTarget, practiceMinutes, practiceMode: 'adaptive' });
      setPreferences(prefs);
      setEditing(false);
      setPractice(null);
      await load();
    } catch (reason) { setError(message(reason)); setLoading(false); }
  }

  const personalHandle = preferences?.personalHandle;
  const snapshot = practice?.handle.toLowerCase() === personalHandle?.toLowerCase() ? practice : null;
  const progress = snapshot?.progress;

  return (
    <main className={`practice-app${fullPage ? ' practice-app--page' : ''}`}>
      <header className="app-header">
        <span className="app-logo" aria-hidden="true">CF<span>↗</span></span>
        <div><h1>CFChart</h1><p>Practice on Codeforces</p></div>
        <span className="app-surface-label">{fullPage ? 'Dashboard' : 'Today'}</span>
      </header>
      {fullPage && personalHandle && <nav className="dashboard-nav" aria-label="Dashboard sections"><a href="#today">Today</a><a href="#practice">Practice</a><a href="#progress">Progress</a><a href="#settings">Settings</a></nav>}

      {error && <div className="notice notice--error" role="alert">{error}<button onClick={() => void load()}>Try again</button></div>}

      {(editing || (preferences && !personalHandle)) && (
        <form className="settings" id="settings" onSubmit={save}>
          <h2>{personalHandle ? 'Practice settings' : 'Connect your account'}</h2>
          {!personalHandle && <p className="muted">Use your Codeforces handle to see today's practice and recommendations.</p>}
          <label htmlFor="personal-handle">Codeforces handle</label>
          <input id="personal-handle" name="handle" autoComplete="off" defaultValue={personalHandle ?? ''} placeholder="Your handle" maxLength={24} pattern="[A-Za-z0-9_.-]+" />
          <label htmlFor="daily-target">Daily goal</label>
          <select id="daily-target" name="target" defaultValue={preferences?.dailyTarget ?? 2}>
            {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} {i ? 'problems' : 'problem'} / day</option>)}
          </select>
          <label htmlFor="practice-minutes">Daily practice time (minutes)</label>
          <input id="practice-minutes" name="minutes" type="number" min="20" max="240" defaultValue={preferences?.practiceMinutes ?? 60} required />
          <p className="muted">Uses public Codeforces data. No password needed. Your tracked handle stays the same when you view other profiles.</p>
          <div className="button-row"><button className="button button--primary" disabled={loading}>{loading ? 'Saving…' : personalHandle ? 'Save settings' : 'Connect and continue'}</button>{personalHandle && <button type="button" className="button" onClick={() => setEditing(false)}>Cancel</button>}</div>
        </form>
      )}

      {personalHandle && !editing && (
        <div className={fullPage ? 'dashboard-layout' : 'popup-layout'}>
          <div className="dashboard-main">
          <div className="account-row"><span>Practicing as <strong>@{personalHandle}</strong></span>{!fullPage && <button className="text-button" onClick={() => setEditing(true)}>Settings</button>}</div>
          {progress ? (
            <section className="daily-card" id="today" aria-label="Daily practice">
              <div className="daily-summary"><div><span className="eyebrow">TODAY'S PROGRESS</span><p className="count">{progress.todayCount}{progress.recentDays.at(-1)?.unknown ? '+' : ''}<span> / {progress.dailyTarget}</span></p></div><span className={`goal-badge${progress.isTodayTargetMet ? ' goal-badge--done' : ''}`}>{progress.isTodayTargetMet ? 'Goal reached ✓' : `${Math.max(0, progress.dailyTarget - progress.todayCount)} to go`}</span></div>
              <progress max={progress.dailyTarget} value={Math.min(progress.todayCount, progress.dailyTarget)} aria-label="Accepted problems today" />
              <p className="daily-caption">{progress.isTodayTargetMet ? 'Daily goal complete' : `${Math.max(0, progress.dailyTarget - progress.todayCount)} more to reach your goal`}{progress.recentDays.at(-1)?.unknown ? ' · Today’s history is still syncing' : ''}</p>
            </section>
          ) : <div className="notice" role="status">{loading ? 'Loading your practice history…' : 'Practice history is unavailable. Try refreshing.'}</div>}

          {snapshot?.error && <div className="notice notice--error" role="status">{snapshot.error}</div>}
          {snapshot?.stale && <p className="muted">Showing saved data from {new Date(snapshot.updatedAt).toLocaleString()}.</p>}

          {snapshot && !snapshot.coverage.complete && <div className="notice"><strong>History sync in progress</strong><p>{snapshot.coverage.loaded.toLocaleString()} submissions loaded. Older activity is still unknown; recommendations appear after the solved history is checked.</p><button className="button" disabled={loading} onClick={() => void load({ syncMore: true })}>{loading ? 'Syncing…' : 'Continue history sync'}</button></div>}

          <div id="practice">{snapshot?.coverage.complete && <PracticeRecommendations key={personalHandle} handle={personalHandle} recommendations={snapshot.recommendations} expandedByDefault={fullPage} />}</div>

          {!fullPage && <div className="button-row app-secondary-actions"><a className="text-button" href={getExtensionApi()?.runtime.getURL?.('dashboard.html') ?? 'dashboard.html'} target="_blank" rel="noreferrer">Open dashboard ↗</a><button className="text-button" disabled={loading} onClick={() => void load({ force: true })}>{loading ? 'Syncing…' : 'Refresh'}</button></div>}
          </div>
          {fullPage && <aside className="dashboard-side">
            <section className="dashboard-panel" id="progress" aria-label="Practice progress"><h2>Practice history</h2>{progress ? <>
              <p className="streak-row"><strong>{progress.currentStreak}{progress.streakIsLowerBound ? '+' : ''}</strong> day streak <span className="muted">· local days</span></p>
              <div className="heatmap" role="img" aria-label={`Last 30 days: ${progress.recentDays.filter(day => day.targetMet).length} goal days and ${progress.recentDays.filter(day => day.unknown).length} days with unknown history`}>{progress.recentDays.map(day => <span key={day.dateStr} className={`heatmap-day${day.unknown ? ' heatmap-day--unknown' : day.targetMet ? ' heatmap-day--met' : day.solvedCount ? ' heatmap-day--some' : ''}`} title={`${day.dateStr}: ${day.unknown ? 'history not fully synced' : `${day.solvedCount} accepted problems`}`} />)}</div>
              <div className="heatmap-labels"><span>30 days ago</span><span>Today</span></div>
              <p className="muted">Patterned days have not been fully synced.</p>
              <details className="heatmap-data"><summary>Daily counts</summary><ul>{progress.recentDays.map(day => <li key={day.dateStr}>{day.dateStr}: {day.unknown ? 'history unknown' : `${day.solvedCount} accepted problems`}</li>)}</ul></details>
            </> : <p className="muted">Practice history is loading.</p>}</section>
            <section className="dashboard-panel" id="settings" aria-label="Account and settings"><h2>Account</h2><p>Tracked handle: <strong>@{personalHandle}</strong></p><p className="muted">Distinct accepted problems count once per local day.</p><div className="button-row"><button className="button" onClick={() => setEditing(true)}>Edit settings</button><button className="button" disabled={loading} onClick={() => void load({ force: true })}>{loading ? 'Syncing…' : 'Refresh data'}</button></div><a className="text-button" href={`https://codeforces.com/profile/${encodeURIComponent(personalHandle)}`} target="_blank" rel="noreferrer">View rating chart ↗</a></section>
          </aside>}
        </div>
      )}

      {!preferences && loading && <p className="muted" role="status">Connecting to CFChart…</p>}
      <footer>Public Codeforces data · Local inference</footer>
    </main>
  );
}
