import { PracticeRecommendations } from '../components/PracticeRecommendations';
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { exportPracticeData, getPreferences, getPractice, getProfile, importPracticeData, subscribeToChanges, updatePreferences } from '../services/extensionClient';
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
  const [backupMessage, setBackupMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const inFlight = useRef(false);
  const lastCompletedAt = useRef(0);
  const hasSnapshot = useRef(false);
  hasSnapshot.current = Boolean(practice);

  const load = useCallback(async (options: { force?: boolean; syncMore?: boolean; silent?: boolean } = {}) => {
    const id = ++request.current;
    inFlight.current = true;
    if (!options.silent || !hasSnapshot.current) setLoading(true);
    try {
      const prefs = await getPreferences();
      if (id !== request.current) return;
      setPreferences(prefs);
      if (!prefs.personalHandle) {
        setPractice(null);
      } else {
        const snapshot = await getPractice(prefs.personalHandle, { force: options.force, syncMore: options.syncMore });
        if (id !== request.current) return;
        setPractice(snapshot);
      }
      lastCompletedAt.current = Date.now();
      setError('');
    } catch (reason) {
      if (id === request.current) setError(message(reason));
    } finally {
      inFlight.current = false;
      if (id === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = subscribeToChanges(changedKeys => {
      const handleKey = preferences?.personalHandle?.toLowerCase();
      if (changedKeys && handleKey) {
        const relevant = changedKeys.some(
          k =>
            k === 'preferences' ||
            k === `cfchart:learning:${handleKey}` ||
            k === `cfchart:practice:${handleKey}` ||
            k === `cfchart:plan:${handleKey}`
        );
        if (!relevant) return;
        const onlySelfPracticeOrPlan = changedKeys.every(
          k => k === `cfchart:practice:${handleKey}` || k === `cfchart:plan:${handleKey}`
        );
        if (onlySelfPracticeOrPlan && (inFlight.current || Date.now() - lastCompletedAt.current < 500)) return;
      } else if (inFlight.current) {
        return;
      }
      void load({ silent: true });
    });
    const onFocus = () => void load({ silent: true });
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => void load({ silent: true }), 60_000);
    return () => { ++request.current; unsubscribe(); window.removeEventListener('focus', onFocus); clearInterval(timer); };
  }, [load, preferences?.personalHandle]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const handle = String(form.get('handle') ?? '').trim();
    const dailyTarget = Number(form.get('target'));
    const rawMinutes = form.get('minutes');
    const practiceMinutes = rawMinutes !== null ? Number(rawMinutes) : undefined;
    setLoading(true);
    setError('');
    try {
      const user = handle ? (await getProfile(handle)).user : null;
      const prefs = await updatePreferences({
        personalHandle: user?.handle ?? null,
        dailyTarget,
        ...(practiceMinutes !== undefined ? { practiceMinutes } : {}),
        practiceMode: 'adaptive',
      });
      setPreferences(prefs);
      setEditing(false);
      setPractice(null);
      await load();
    } catch (reason) { setError(message(reason)); setLoading(false); }
  }

  const personalHandle = preferences?.personalHandle;
  const snapshot = practice?.handle.toLowerCase() === personalHandle?.toLowerCase() ? practice : null;
  const progress = snapshot?.progress;
  const nowDate = new Date();
  const todayStr = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;
  const isLightDay = preferences?.lightDay === todayStr;

  async function toggleLightDay() {
    setError('');
    try {
      const next = await updatePreferences({ lightDay: isLightDay ? null : todayStr });
      setPreferences(next);
      await load({ silent: true });
    } catch (reason) {
      setError(message(reason));
    }
  }

  async function handleExportBackup() {
    if (!personalHandle) return;
    setError('');
    setBackupMessage('');
    try {
      const data = await exportPracticeData(personalHandle);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cfchart-backup-${personalHandle}-${todayStr}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setBackupMessage('Backup exported.');
    } catch (reason) {
      setError(message(reason));
    }
  }

  async function handleImportBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !personalHandle) return;
    setError('');
    setBackupMessage('');
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const result = await importPracticeData(personalHandle, parsed);
      setBackupMessage(
        result.importedEvents > 0
          ? `Restored ${result.importedEvents} event${result.importedEvents === 1 ? '' : 's'}.`
          : 'Backup already up to date.'
      );
      await load();
    } catch (reason) {
      setError(message(reason));
    }
  }

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
          {personalHandle && (
            <>
              <label htmlFor="practice-minutes">Daily practice time (minutes)</label>
              <input id="practice-minutes" name="minutes" type="number" min="20" max="240" defaultValue={preferences?.practiceMinutes ?? 60} required />
            </>
          )}
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

          <div id="practice">{snapshot?.coverage.complete && <PracticeRecommendations key={personalHandle} handle={personalHandle} recommendations={snapshot.recommendations} expandedByDefault={fullPage} lightDay={isLightDay} onToggleLightDay={() => void toggleLightDay()} onFeedbackRecorded={() => void load()} />}</div>

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
            <section className="dashboard-panel" id="settings" aria-label="Account and settings"><h2>Account</h2><p>Tracked handle: <strong>@{personalHandle}</strong></p><p className="muted">Distinct accepted problems count once per local day. Reviews and feedback auto-backup via browser sync.</p><div className="button-row"><button className="button" onClick={() => setEditing(true)}>Edit settings</button><button className="button" disabled={loading} onClick={() => void load({ force: true })}>{loading ? 'Syncing…' : 'Refresh data'}</button></div><div className="button-row"><button type="button" className="button" onClick={() => void handleExportBackup()}>Export backup</button><button type="button" className="button" onClick={() => fileInputRef.current?.click()}>Import backup</button><input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={event => void handleImportBackup(event)} /></div>{backupMessage && <p className="muted" role="status">{backupMessage}</p>}<a className="text-button" href={`https://codeforces.com/profile/${encodeURIComponent(personalHandle)}`} target="_blank" rel="noreferrer">View rating chart ↗</a></section>
          </aside>}
        </div>
      )}

      {!preferences && loading && <p className="muted" role="status">Connecting to CFChart…</p>}
      <footer>Public Codeforces data · Local inference</footer>
    </main>
  );
}
