import type { PracticeSnapshot, ProfileSnapshot } from '../types/app';
import { getForecast, type ForecastModel, type ForecastResult } from '../ml';

/** Official ratings and submissions must both be usable before local inference. */
export function profileForecast(profile: ProfileSnapshot | null, practice: PracticeSnapshot | null, model: ForecastModel | null, referenceDate = new Date()): ForecastResult {
  if (!model) return getForecast({ ratings: [], submissions: [] }, referenceDate, null);
  if (!profile || !practice) return { available: false, reason: 'Forecast inputs are loading.' };
  if (profile.stale || profile.error || practice.stale || practice.error) {
    return { available: false, reason: 'Refresh profile and submission data before generating an ML forecast. Cached history is still shown above.' };
  }
  const fetchedAt = Math.min(profile.updatedAt, practice.updatedAt);
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) return { available: false, reason: 'Refresh profile and submission data before generating an ML forecast.' };
  try {
    return getForecast({ ratings: profile.ratings, submissions: practice.submissions,
      coverage: { complete: practice.coverage.complete, oldestSubmissionTimeSeconds: practice.coverage.earliestTime, fetchedAt },
    }, referenceDate, model);
  } catch {
    return { available: false, reason: 'ML forecast unavailable: the installed model could not be evaluated.' };
  }
}

export function needsForecastHistory(practice: PracticeSnapshot | null, model: ForecastModel | null, referenceDate = new Date()): boolean {
  if (!practice || !model || practice.coverage.complete) return false;
  const oldest = practice.coverage.earliestTime;
  return oldest === undefined || referenceDate.getTime() / 1000 - oldest < model.minimumHistoryDays * 86400;
}
