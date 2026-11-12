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
  const featuredForecast = forecast.available ? forecast.forecasts[0] : null;
  const lastContest = profile?.ratings.reduce((latest, item) => Math.max(latest, item.ratingUpdateTimeSeconds), 0) ?? 0;
  return <section className="cf-panel cf-profile" aria-label={`CFChart for ${handle}`}>
    <div className="cf-panel-heading">
      <div className="cf-heading-copy"><div><h2>Rating history</h2><p>{handle} · Official Codeforces results{lastContest ? ` · Last contest ${new Date(lastContest * 1000).toLocaleDateString()}` : ''}</p></div></div>
      <button type="button" className="cf-link" onClick={() => setRetry(value => value + 1)} disabled={loading}>Refresh</button>
    </div>
    {loading && <div className="cf-empty" role="status"><span className="cf-spinner" /> Loading official rating history…</div>}
    {error && <div className="cf-notice cf-error" role="alert">{error} <button type="button" className="cf-link" onClick={() => setRetry(value => value + 1)}>Retry</button><p>The original chart stays available below.</p></div>}
    {profile && !loading && <>
      <div className="cf-stat-row"><div><span>Official rating</span><strong style={{ color: getRankTier(currentRating ?? undefined).color }}>{currentRating ?? 'Unrated'}</strong></div><div><span>Best rating</span><strong>{profile.user.maxRating ?? '—'}</strong></div><div><span>Rated contests</span><strong>{profile.ratings.length}</strong></div><div className="cf-sync-status"><span>{profile.stale ? 'Saved data' : 'Checked'}</span><small>{new Date(profile.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</small></div></div>
      {profile.error && <p className="cf-notice" role="status">{profile.error} {profile.stale ? 'Showing saved history.' : 'Some profile data is unavailable.'}</p>}
      <div className="cf-forecast-summary" aria-label="Model forecast">
        <div className="cf-forecast-summary-heading"><h3>Model estimate</h3><span>Not an official rating</span></div>
        {featuredForecast ? <p><strong>{featuredForecast.horizonDays} days: {featuredForecast.median}</strong><span>Model range {featuredForecast.lower}–{featuredForecast.upper} · Inputs checked {new Date(Math.min(profile.updatedAt, practice?.updatedAt ?? profile.updatedAt)).toLocaleDateString()}</span></p> : <p className="cf-forecast-unavailable">{forecast.available ? 'Forecast values are unavailable.' : forecast.reason}</p>}
      </div>
      <p className="cf-chart-summary">{profile.ratings.length ? `Official rating history across ${profile.ratings.length} rated contest${profile.ratings.length === 1 ? '' : 's'}.` : 'No official rated contests yet.'} Open the contest history below for exact values.</p>
      <HorizonChart data={historicalChartPoints(profile.ratings)} currentRating={currentRating} forecasts={forecast.available ? forecast.forecasts : []} />
      <details className="cf-forecast-note"><summary>Forecast details and data status</summary>
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
                  <strong>{p.lower} – {p.upper}</strong>
                  {delta != null && <span className={`cf-forecast-delta ${delta >= 0 ? 'is-up' : 'is-down'}`}>{delta >= 0 ? `+${delta}` : delta} vs now</span>}
                </div>
              </div>;
            })}
          </div>
          <p>These are model estimates with uncertainty ranges. Actual contest results may differ.</p>
        </> : <p>{forecast.reason}</p>}
        {forecastError && <p className="cf-error" role="alert">{forecastError}</p>}
        {bundledForecastModel && (missingForecastHistory || forecastError || practice?.stale || practice?.error) && <button type="button" className="cf-link" disabled={forecastLoading} onClick={() => syncForecast(missingForecastHistory)}>{forecastLoading ? 'Syncing forecast inputs…' : missingForecastHistory ? 'Sync more forecast history' : 'Refresh forecast inputs'}</button>}
        {bundledForecastModel && missingForecastHistory && <p>Loads one older page of submissions per click. Complete coverage is required for the model’s practice window.</p>}
      </details>
    </>}
  </section>;
};
