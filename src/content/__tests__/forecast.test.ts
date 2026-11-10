import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ForecastModel } from '../../ml';
import type { PracticeSnapshot, ProfileSnapshot } from '../../types/app';
const inference = vi.hoisted(() => ({ getForecast: vi.fn() }));
vi.mock('../../ml', () => inference);
import { needsForecastHistory, profileForecast } from '../forecast';
const now = new Date('2026-11-10T12:00:00Z');
const profile: ProfileSnapshot = { handle: 'fixture', user: { handle: 'fixture', rating: 1400 }, ratings: [], updatedAt: now.getTime() - 5000 };
const practice: PracticeSnapshot = { handle: 'fixture', submissions: [], recommendations: [], updatedAt: now.getTime(), coverage: { complete: true, loaded: 0 }, progress: { dailyTarget: 2, todayCount: 0, isTodayTargetMet: false, todayProblems: [], currentStreak: 0, recentDays: [], lastUpdated: now.getTime() } };
// Only an adapter contract fixture; no weights or model validation claims.
const model = { minimumHistoryDays: 90 } as ForecastModel;
describe('profile forecast data guards', () => {
  beforeEach(() => { inference.getForecast.mockReset().mockReturnValue({ available: true, version: 'unit-fixture', asOf: now.getTime(), forecasts: [] }); });
  it('suppresses inference if either source is stale or has an error', () => {
    for (const flag of [{ stale: true }, { error: 'API failed' }]) {
      expect(profileForecast({ ...profile, ...flag }, practice, model, now).available).toBe(false);
      expect(profileForecast(profile, { ...practice, ...flag }, model, now).available).toBe(false);
    }
    expect(inference.getForecast).not.toHaveBeenCalled();
  });
  it('uses the older of rating and practice observation timestamps for freshness', () => {
    profileForecast(profile, practice, model, now);
    expect(inference.getForecast.mock.calls[0][0].coverage.fetchedAt).toBe(profile.updatedAt);
    inference.getForecast.mockClear();
    profileForecast(profile, { ...practice, updatedAt: profile.updatedAt - 1_000_000 }, model, now);
    expect(inference.getForecast.mock.calls[0][0].coverage.fetchedAt).toBe(profile.updatedAt - 1_000_000);
  });
  it('offers another bounded page only when model history coverage is insufficient', () => {
    expect(needsForecastHistory(practice, model, now)).toBe(false);
    expect(needsForecastHistory({ ...practice, coverage: { complete: false, loaded: 1000, earliestTime: now.getTime() / 1000 - 10 * 86400 } }, model, now)).toBe(true);
    expect(needsForecastHistory({ ...practice, coverage: { complete: false, loaded: 1000, earliestTime: now.getTime() / 1000 - 100 * 86400 } }, model, now)).toBe(false);
    expect(needsForecastHistory({ ...practice, coverage: { complete: false, loaded: 1000 } }, null, now)).toBe(false);
  });
  it('reports malformed model failures without breaking the official chart', () => {
    inference.getForecast.mockImplementation(() => { throw new Error('Malformed tree'); });
    expect(profileForecast(profile, practice, model, now)).toEqual({ available: false, reason: 'ML forecast unavailable: the installed model could not be evaluated.' });
  });
});
