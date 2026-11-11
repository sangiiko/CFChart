import React, { useEffect, useRef, useState } from 'react';
import { getProfile, getPractice } from '../../services/extensionClient';
import { historicalChartPoints } from '../../services/predictorModel';
import { HorizonChart } from '../../components/HorizonChart';
import { getRankTier } from '../../services/codeforcesApi';
import { bundledForecastModel } from '../../ml';
import { profileForecast, needsForecastHistory } from '../forecast';

type Profile = Awaited<ReturnType<typeof getProfile>>;
type Practice = Awaited<ReturnType<typeof getPractice>>;
interface Props {
  handle: string;
  onNativeVisibilityChange: (visible: boolean) => void;
}
export const ProfileHorizonCard: React.FC<Props> = ({ handle, onNativeVisibilityChange }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [practice, setPractice] = useState<Practice | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState('');
  const forecastRequest = useRef(0);
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
  useEffect(() => {
    onNativeVisibilityChange(!canEnhance);
    return () => onNativeVisibilityChange(true);
  }, [canEnhance, onNativeVisibilityChange]);
  const forecast = forecastError ? { available: false as const, reason: `Forecast inputs unavailable: ${forecastError}` } : profileForecast(profile, practice, bundledForecastModel);
  const missingForecastHistory = needsForecastHistory(practice, bundledForecastModel);
  const currentRating = profile?.user.rating ?? null;
  return <section className="cf-panel cf-profile" aria-label={`CFChart for ${handle}`}>
    <div className="cf-panel-heading"><div className="cf-heading-copy"><span className="cf-brand-mark" aria-hidden="true">↗</span><div><h2>CFChart <span className="cf-subtle">/ {handle}</span></h2><p>Your rating, with a clearer view ahead.</p></div></div></div>
    {loading && <div className="cf-empty" role="status"><span className="cf-spinner" /> Loading official rating history…</div>}
    {error && <div className="cf-notice cf-error" role="alert">{error} <button type="button" className="cf-link" onClick={() => setRetry(value => value + 1)}>Retry</button><p>The original chart stays available below.</p></div>}
    {profile && !loading && <>
      <div className="cf-stat-row"><div><span>Current rating</span><strong style={{ color: getRankTier(currentRating ?? undefined).color }}>{currentRating ?? 'Unrated'}</strong></div><div><span>Best rating</span><strong>{profile.user.maxRating ?? '—'}</strong></div><div><span>Rated contests</span><strong>{profile.ratings.length}</strong></div><div className="cf-sync-status"><span>{profile.stale ? 'Cached data' : 'Last synced'}</span><small>{new Date(profile.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</small><button type="button" className="cf-link" onClick={() => setRetry(value => value + 1)}>Refresh</button></div></div>
      {profile.error && <p className="cf-notice" role="status">{profile.error} {profile.stale ? 'Showing saved history.' : 'Some profile data is unavailable.'}</p>}
      <HorizonChart data={historicalChartPoints(profile.ratings)} currentRating={currentRating} forecasts={forecast.available ? forecast.forecasts : []} />
      <div className="cf-forecast-note">
        <div className="cf-forecast-header">
          <span className="cf-small-label">ML RATING FORECAST</span>
          {forecast.available && <span className="cf-confidence-badge" title="Trained and calibrated on 1,600+ users to ensure 85% empirical coverage on unseen holdout contests">85% Calibrated Confidence</span>}
        </div>
        {forecast.available ? <>
          <div className="cf-forecast-grid">
            {forecast.forecasts.map(p => {
              const tier = getRankTier(p.median);
              const margin = Math.round((p.upper - p.lower) / 2);
              const delta = currentRating != null ? p.median - currentRating : null;
              return <div key={p.horizonDays} className="cf-forecast-card">
                <div className="cf-forecast-card-title">{p.horizonDays}-Day Horizon</div>
                <div className="cf-forecast-card-val">
                  <strong style={{ color: tier.color }}>{p.median}</strong>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: tier.color }}>{tier.name}</span>
                  <span className="cf-forecast-margin">±{margin} pts</span>
                </div>
                <div className="cf-forecast-range">
                  <span>85% interval:</span>
                  <strong>{p.lower} – {p.upper}</strong>
                  {delta != null && <span className={`cf-forecast-delta ${delta >= 0 ? 'is-up' : 'is-down'}`}>{delta >= 0 ? `+${delta}` : delta} vs now</span>}
                </div>
              </div>;
            })}
          </div>
          <p className="cf-forecast-caption">Model {forecast.version}. Predictions calibrated to 85% coverage on unseen holdout contests. Shaded error bars depict the uncertainty margin for each time horizon.</p>
        </> : <p>{forecast.reason}</p>}
        {forecastError && <p className="cf-error" role="alert">{forecastError}</p>}
        {bundledForecastModel && (missingForecastHistory || forecastError || practice?.stale || practice?.error) && <button type="button" className="cf-link" disabled={forecastLoading} onClick={() => syncForecast(missingForecastHistory)}>{forecastLoading ? 'Syncing forecast inputs…' : missingForecastHistory ? 'Sync more forecast history' : 'Refresh forecast inputs'}</button>}
        {bundledForecastModel && missingForecastHistory && <p>Loads one older page of submissions per click. Complete coverage is required for the model’s practice window.</p>}
      </div>
    </>}
  </section>;
};
