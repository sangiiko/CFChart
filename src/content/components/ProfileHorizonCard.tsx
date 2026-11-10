import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getPreferences, getProfile, getPractice } from '../../services/extensionClient';
import { generateHorizonProjection, historicalChartPoints } from '../../services/predictorModel';
import { HorizonChart } from '../../components/HorizonChart';
import { PracticeSimulator } from '../../components/PracticeSimulator';
import { getRankTier } from '../../services/codeforcesApi';
import { bundledForecastModel } from '../../ml';
import { profileForecast, needsForecastHistory } from '../forecast';

type Preferences = Awaited<ReturnType<typeof getPreferences>>;
type Profile = Awaited<ReturnType<typeof getProfile>>;
type Practice = Awaited<ReturnType<typeof getPractice>>;
interface Props {
  handle: string;
  preferences: Preferences;
  nativeAvailable: boolean;
  onPreferencesChange: (changes: Partial<Preferences>) => Promise<void>;
  onNativeVisibilityChange: (visible: boolean) => void;
}
export const ProfileHorizonCard: React.FC<Props> = ({ handle, preferences, nativeAvailable, onPreferencesChange, onNativeVisibilityChange }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [practice, setPractice] = useState<Practice | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [scenario, setScenario] = useState(false);
  const [params, setParams] = useState(preferences.predictionParams);
  const [saveError, setSaveError] = useState('');
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState('');
  const forecastRequest = useRef(0);
  useEffect(() => { setParams(preferences.predictionParams); }, [preferences.predictionParams]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setProfile(null); setPractice(null);
    getProfile(handle, { force: retry > 0 }).then(value => { if (active) setProfile(value); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load this profile.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [handle, retry]);
  // Each action fetches one bounded page; forecasting never blocks official history.
  useEffect(() => {
    if (!profile || !bundledForecastModel) return;
    const request = ++forecastRequest.current;
    setForecastLoading(true); setForecastError('');
    getPractice(handle).then(value => { if (request === forecastRequest.current) setPractice(value); }).catch(reason => { if (request === forecastRequest.current) setForecastError(reason instanceof Error ? reason.message : 'Forecast inputs could not be loaded.'); }).finally(() => { if (request === forecastRequest.current) setForecastLoading(false); });
    return () => { ++forecastRequest.current; };
  }, [profile, handle]);
  const syncForecast = async (more: boolean) => {
    const request = ++forecastRequest.current;
    setForecastLoading(true); setForecastError('');
    try {
      const value = await getPractice(handle, more ? { syncMore: true } : { force: true });
      if (request === forecastRequest.current) setPractice(value);
    } catch (reason) { if (request === forecastRequest.current) setForecastError(reason instanceof Error ? reason.message : 'Forecast inputs could not be loaded.'); }
    finally { if (request === forecastRequest.current) setForecastLoading(false); }
  };
  const canEnhance = !!profile && !loading && !error && (!profile.error || profile.ratings.length > 0);
  const enhanced = preferences.chartView === 'enhanced';
  useEffect(() => {
    onNativeVisibilityChange(!enhanced || !canEnhance);
    return () => onNativeVisibilityChange(true);
  }, [enhanced, canEnhance, onNativeVisibilityChange]);
  const horizon = useMemo(() => profile ? generateHorizonProjection(profile.ratings, profile.user.rating, params) : null, [profile, params]);
  const forecast = forecastError ? { available: false as const, reason: `Forecast inputs unavailable: ${forecastError}` } : profileForecast(profile, practice, bundledForecastModel);
  const missingForecastHistory = needsForecastHistory(practice, bundledForecastModel);
  const currentRating = profile?.user.rating ?? null;
  const changeView = async (chartView: Preferences['chartView']) => {
    setSaveError('');
    if (chartView === 'original') onNativeVisibilityChange(true);
    try { await onPreferencesChange({ chartView }); } catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Could not save chart preference.'); }
  };
  const saveScenario = () => onPreferencesChange({ predictionParams: params }).catch(reason => setSaveError(reason instanceof Error ? reason.message : 'Could not save scenario.'));
  return <section className="cf-panel cf-profile" aria-label={`CFChart for ${handle}`}>
    <div className="cf-panel-heading"><div className="cf-heading-copy"><span className="cf-brand-mark" aria-hidden="true">↗</span><div><h2>CFChart <span className="cf-subtle">/ {handle}</span></h2><p>Your rating, with a clearer view ahead.</p></div></div><div className="cf-segment" role="group" aria-label="Rating chart view"><button type="button" className={enhanced ? 'is-active' : ''} aria-pressed={enhanced} onClick={() => changeView('enhanced')}>Enhanced</button><button type="button" className={!enhanced ? 'is-active' : ''} aria-pressed={!enhanced} disabled={!nativeAvailable} title={nativeAvailable ? 'Show the original Codeforces chart' : 'This page has no original rating graph'} onClick={() => changeView('original')}>Original</button></div></div>
    {saveError && <p className="cf-notice cf-error" role="alert">{saveError}</p>}
    {!enhanced && <p className="cf-original-note">The original Codeforces chart is shown below.</p>}
    {enhanced && <>
      {loading && <div className="cf-empty" role="status"><span className="cf-spinner" /> Loading official rating history…</div>}
      {error && <div className="cf-notice cf-error" role="alert">{error} <button type="button" className="cf-link" onClick={() => setRetry(value => value + 1)}>Retry</button><p>The original chart stays available below.</p></div>}
      {profile && !loading && <>
        <div className="cf-stat-row"><div><span>Current rating</span><strong style={{ color: getRankTier(currentRating ?? undefined).color }}>{currentRating ?? 'Unrated'}</strong></div><div><span>Best rating</span><strong>{profile.user.maxRating ?? '—'}</strong></div><div><span>Rated contests</span><strong>{profile.ratings.length}</strong></div><div className="cf-sync-status"><span>{profile.stale ? 'Cached data' : 'Last synced'}</span><small>{new Date(profile.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</small><button type="button" className="cf-link" onClick={() => setRetry(value => value + 1)}>Refresh</button></div></div>
        {profile.error && <p className="cf-notice" role="status">{profile.error} {profile.stale ? 'Showing saved history.' : 'Some profile data is unavailable.'}</p>}
        <HorizonChart data={scenario && horizon ? horizon.chartData : historicalChartPoints(profile.ratings)} currentRating={currentRating} forecasts={forecast.available ? forecast.forecasts : []} />
        <div className="cf-forecast-note"><span className="cf-small-label">ML FORECAST</span><p>{forecast.available ? `Model ${forecast.version}. The markers show 30- and 90-day estimates; the intervals represent uncertainty.` : forecast.reason}</p>
          {forecastError && <p className="cf-error" role="alert">{forecastError}</p>}
          {bundledForecastModel && (missingForecastHistory || forecastError || practice?.stale || practice?.error) && <button type="button" className="cf-link" disabled={forecastLoading} onClick={() => syncForecast(missingForecastHistory)}>{forecastLoading ? 'Syncing forecast inputs…' : missingForecastHistory ? 'Sync more forecast history' : 'Refresh forecast inputs'}</button>}
          {bundledForecastModel && missingForecastHistory && <p>Loads one older page of submissions per click. Complete coverage is required for the model’s practice window.</p>}
        </div>
        {currentRating !== null && <div className="cf-scenario"><label className="cf-check"><input type="checkbox" checked={scenario} onChange={e => setScenario(e.target.checked)} /><span>Explore a practice scenario <small>Illustrative · separate from ML</small></span></label>{scenario && horizon?.projectedRatingAtHorizon != null && <><PracticeSimulator params={params} onChange={setParams} projectedRating={horizon.projectedRatingAtHorizon} currentRating={currentRating} totalProblems={horizon.totalProjectedProblems} /><button type="button" className="cf-link cf-save-scenario" onClick={saveScenario}>Save scenario settings</button></>}</div>}
      </>}
    </>}
  </section>;
};
