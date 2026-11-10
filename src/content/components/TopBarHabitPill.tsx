import type { RequestOptions } from '../../types/app';
import React, { useEffect, useRef, useState } from 'react';
import { getPreferences, getProfile, getPractice, subscribeToChanges } from '../../services/extensionClient';
type Preferences = Awaited<ReturnType<typeof getPreferences>>;
type Practice = Awaited<ReturnType<typeof getPractice>>;
interface Props { preferences: Preferences; onPreferencesChange: (changes: Partial<Preferences>) => Promise<void> }
export const TopBarHabitPill: React.FC<Props> = ({ preferences, onPreferencesChange }) => {
  const [open, setOpen] = useState(false);
  const [practice, setPractice] = useState<Practice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [settingHandle, setSettingHandle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const requestedOptions = useRef<RequestOptions>({ force: false, syncMore: false });
  const wrapper = useRef<HTMLDivElement>(null);
  const lastFetch = useRef(0);
  const handle = preferences.personalHandle;
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (wrapper.current && !event.composedPath().includes(wrapper.current)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => {
    if (!handle) { setPractice(null); return; }
    let active = true;
    setLoading(true); setError(''); lastFetch.current = Date.now();
    const options = requestedOptions.current; requestedOptions.current = { force: false, syncMore: false };
    getPractice(handle, options).then(value => { if (active) setPractice(value); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Practice data could not be loaded.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [handle, preferences.dailyTarget, revision]);
  useEffect(() => {
    if (!handle) return;
    let active = true;
    const unsubscribe = subscribeToChanges(() => {
      getPractice(handle).then(value => { if (active) setPractice(value); }).catch(() => {});
    });
    const onReturn = () => {
      if (document.visibilityState === 'hidden' || Date.now() - lastFetch.current < 15_000) return;
      requestedOptions.current = { force: true, syncMore: false }; setRevision(value => value + 1);
    };
    // Only the visible tab refreshes; this also crosses local midnight correctly.
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      requestedOptions.current = { force: false, syncMore: false }; setRevision(value => value + 1);
    }, 60_000);
    window.addEventListener('focus', onReturn); document.addEventListener('visibilitychange', onReturn);
    return () => { active = false; unsubscribe(); window.clearInterval(refreshTimer); window.removeEventListener('focus', onReturn); document.removeEventListener('visibilitychange', onReturn); };
  }, [handle]);
  // A profile switch never briefly displays the previous account's progress.
  const current = practice?.handle.toLowerCase() === handle?.toLowerCase() ? practice : null;
  const progress = current?.progress;
  const todayUnknown = progress?.recentDays[progress.recentDays.length - 1]?.unknown;
  const connect = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const profile = await getProfile(input.trim());
      await onPreferencesChange({ personalHandle: profile.user.handle });
      setSettingHandle(false); setInput('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not verify this handle.'); }
    finally { setBusy(false); }
  };
  const refresh = (more = false, resetHistory = false) => { requestedOptions.current = { force: true, syncMore: more, ...(resetHistory ? { resetHistory: true } : {}) }; setRevision(value => value + 1); };
  return <div className="cf-personal" ref={wrapper}>
    <button type="button" className={`cf-habit-pill ${progress?.isTodayTargetMet ? 'is-complete' : ''}`} aria-expanded={open} aria-controls="cfchart-practice-popover" onClick={() => setOpen(value => !value)}><span className="cf-pill-symbol" aria-hidden="true">↗</span><span>{!handle ? 'Set up CFChart' : loading && !progress ? 'CFChart · syncing…' : progress ? `Today ${progress.todayCount}${todayUnknown ? '+' : ''}/${progress.dailyTarget}` : 'CFChart · unavailable'}</span>{progress && <span className="cf-streak">{progress.currentStreak}{progress.streakIsLowerBound ? '+' : ''}d streak</span>}<span aria-hidden="true">⌄</span></button>
    {open && <section id="cfchart-practice-popover" className="cf-popover" aria-label="Personal practice tracker">
      <div className="cf-popover-heading"><div><span className="cf-small-label">YOUR DAILY PRACTICE</span><h2>{handle || 'Connect a Codeforces handle'}</h2></div><button type="button" className="cf-icon-button" aria-label="Close practice tracker" onClick={() => setOpen(false)}>×</button></div>
      {(!handle || settingHandle) && <form className="cf-connect" onSubmit={connect}><label htmlFor="cfchart-handle-input">Codeforces handle</label><div className="cf-form-row"><input id="cfchart-handle-input" value={input} onChange={event => setInput(event.target.value)} required maxLength={24} placeholder="Your handle" autoComplete="off" /><button className="cf-button" disabled={busy} type="submit">{busy ? 'Checking…' : 'Connect'}</button></div><p className="cf-muted">Uses public profile data. No password needed.</p>{handle && <button type="button" className="cf-link" onClick={() => setSettingHandle(false)}>Cancel</button>}</form>}
      {error && <p className="cf-notice cf-error" role="alert">{error} {handle && <button type="button" className="cf-link" onClick={() => refresh()}>Retry</button>}</p>}
      {handle && !settingHandle && <>
        {loading && !progress && <p className="cf-empty" role="status">Loading your submissions…</p>}
        {progress && <>
          <div className="cf-daily-status"><strong>{progress.todayCount}{todayUnknown ? '+' : ''}<span> / {progress.dailyTarget}</span></strong><div>{progress.isTodayTargetMet ? 'Daily goal complete' : `${Math.max(0, progress.dailyTarget - progress.todayCount)} more to reach your goal`}<small>{progress.currentStreak}{progress.streakIsLowerBound ? '+' : ''} day streak{progress.historyComplete === false ? ' · history still syncing' : ''}</small></div></div>
          <progress className="cf-progress" value={Math.min(progress.todayCount, progress.dailyTarget)} max={progress.dailyTarget} aria-label="Daily problem goal" />
          <div className="cf-goal-row"><label>Daily goal <select aria-label="Daily problem goal" value={preferences.dailyTarget} onChange={event => onPreferencesChange({ dailyTarget: Number(event.target.value) }).catch(reason => setError(String(reason)))}>{[1, 2, 3, 4, 5].map(target => <option key={target} value={target}>{target} problem{target > 1 ? 's' : ''}</option>)}</select></label><span className="cf-muted">Your local day</span></div>
          <div className="cf-heatmap" aria-label="Last 30 days of practice">{progress.recentDays.map(day => <span key={day.dateStr} className={day.unknown ? 'is-unknown' : day.targetMet ? 'is-met' : day.solvedCount > 0 ? 'is-some' : ''} title={`${day.dateStr}: ${day.unknown ? 'not synced yet' : `${day.solvedCount} unique problems`}`} />)}</div>
          <div className="cf-heatmap-caption"><span>30 days</span><span>Empty · partial · goal met</span></div>
          {progress.todayProblems.length > 0 && <div className="cf-problem-list"><h3>Solved today</h3>{progress.todayProblems.map(problem => <a key={problem.key} href={problem.url}><span>{problem.contestId}{problem.index} · {problem.name}</span><span className="cf-solved-check">✓</span></a>)}</div>}
          {current?.error && <p className="cf-notice" role="status">{current.error} Showing saved data.</p>}
          {current && !current.coverage.complete && <div className="cf-notice"><p>{current.coverage.loaded.toLocaleString()} submissions synced. Older activity is still unknown. Recommendations are live based on current history.</p><button type="button" className="cf-link" disabled={loading} onClick={() => refresh(true)}>{loading ? 'Syncing…' : 'Sync more history'}</button></div>}
          {current?.coverage.complete && <div className="cf-notice"><p>Older verdicts may change after a rejudge.{current.coverage.lastFullSyncAt ? ` Full history checked ${new Date(current.coverage.lastFullSyncAt).toLocaleDateString()}.` : ''}</p><button type="button" className="cf-link" disabled={loading} onClick={() => refresh(false, true)}>Recheck solved history</button></div>}
          {!loading && !!current?.recommendations.length && <div className="cf-problem-list"><h3>Try next <span>Unsolved practice</span></h3>{current.recommendations.map(problem => <a key={problem.url} href={problem.url} title={(problem.reasons ?? []).join(' · ')}><span><small className={`cf-slot cf-slot--${problem.slot}`}>{problem.slotLabel} · {Math.round(problem.pSolve * 100)}% · {problem.rating}</small>{problem.contestId}{problem.index} · {problem.name}</span><span aria-hidden="true">↗</span></a>)}</div>}
        </>}
        <div className="cf-popover-footer"><a href={`/profile/${encodeURIComponent(handle)}`}>View your rating chart ↗</a><button type="button" className="cf-link" disabled={loading} onClick={() => refresh()}>{loading ? 'Refreshing…' : 'Refresh'}</button></div><div className="cf-personal-footer"><button type="button" className="cf-link" onClick={() => { setInput(handle); setSettingHandle(true); }}>Change handle</button>{current && <span>{current.stale ? 'Cached · ' : ''}{new Date(current.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>}</div>
      </>}
    </section>}
  </div>;
};
