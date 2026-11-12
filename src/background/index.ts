import type { ExtensionRequest, ExtensionResponse, PracticeSnapshot } from '../types/app';
import { dataBroker } from '../services/dataBroker';
import { getExtensionApi } from '../services/storage';

const api = getExtensionApi();
const ALARM = 'cfchart_refresh';

async function updateBadge(practice?: PracticeSnapshot, error?: string) {
  if (!api?.action) return;
  let text = '';
  let color = '#64748b';
  let title = 'CFChart — connect your Codeforces handle';
  if (error) {
    text = '!';
    color = '#b7791f';
    title = `CFChart — ${error}`;
  } else if (practice) {
    const { todayCount, dailyTarget, isTodayTargetMet, recentDays } = practice.progress;
    const unknown = recentDays[recentDays.length - 1]?.unknown;
    text = isTodayTargetMet ? '✓' : unknown ? `${todayCount}+` : `${todayCount}/${dailyTarget}`;
    color = isTodayTargetMet ? '#15803d' : todayCount ? '#0284c7' : '#64748b';
    title = `CFChart — ${practice.handle}: ${todayCount}${unknown ? '+' : ''}/${dailyTarget} accepted today${practice.stale ? ' (cached)' : ''}`;
  }
  await Promise.all([
    api.action.setBadgeText({ text }),
    api.action.setBadgeBackgroundColor({ color }),
    api.action.setTitle({ title }),
  ]);
}

async function refreshHabitStatus(force = false) {
  try {
    const preferences = await dataBroker.getPreferences();
    if (!preferences.personalHandle) {
      await updateBadge();
      return;
    }
    const practice = await dataBroker.getPractice(preferences.personalHandle, { force });
    await updateBadge(practice);
  } catch (error) {
    await updateBadge(undefined, error instanceof Error ? error.message : 'Refresh failed. Open CFChart to retry.');
  }
}

async function handleRequest(message: ExtensionRequest): Promise<ExtensionResponse> {
  try {
    switch (message.action) {
      case 'removeTodaySolve':
        await dataBroker.removeTodaySolve(message.handle, message.key);
        await refreshHabitStatus();
        return { ok: true, data: undefined };
      case 'recordPracticeFeedback':
        await dataBroker.recordPracticeFeedback(message.handle, message.feedback);
        return { ok: true, data: undefined };
      case 'exportPracticeData':
        return { ok: true, data: await dataBroker.exportPracticeData(message.handle) };
      case 'clearPracticeData':
        await dataBroker.clearPracticeData(message.handle);
        return { ok: true, data: undefined };
      case 'practiceSession':
        return { ok: true, data: await dataBroker.practiceSession(message.handle, message.key, message.event) };
      case 'getPreferences':
        return { ok: true, data: await dataBroker.getPreferences() };
      case 'updatePreferences': {
        const preferences = await dataBroker.updatePreferences(message.preferences);
        void refreshHabitStatus().catch(console.warn);
        return { ok: true, data: preferences };
      }
      case 'detectViewer':
        return { ok: true, data: await dataBroker.detectViewer(message.handle) };
      case 'getProfile':
        return { ok: true, data: await dataBroker.getProfile(message.handle, message.options) };
      case 'getPractice': {
        const practice = await dataBroker.getPractice(message.handle, message.options);
        const preferences = await dataBroker.getPreferences();
        if (preferences.personalHandle?.toLowerCase() === message.handle.toLowerCase()) await updateBadge(practice);
        return { ok: true, data: practice };
      }
      default:
        return { ok: false, error: 'Unsupported CFChart request.', code: 'invalid_request' };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'CFChart could not load this data. Retry shortly.',
      code: error instanceof Error && 'code' in error ? String(error.code) : 'request_failed',
    };
  }
}

if (api) {
  // Register synchronously so messages can wake the MV3 event background.
  const onMessage = (message: unknown, sender: { id?: string }, sendResponse: (response: ExtensionResponse) => void) => {
    if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'CFCHART_REQUEST') return undefined;
    if (sender.id && sender.id !== api.runtime.id) return undefined;
    // Chrome MV3 does not reliably keep the channel open for a returned Promise.
    // The callback form works in both Chrome and Firefox.
    void handleRequest(message as ExtensionRequest).then(sendResponse, error => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'CFChart could not load this data. Retry shortly.',
        code: 'request_failed',
      } satisfies ExtensionResponse);
    });
    return true;
  };
  api.runtime.onMessage.addListener(onMessage as Parameters<typeof api.runtime.onMessage.addListener>[0]);
  api.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM) void refreshHabitStatus(true).catch(console.warn);
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.preferences) void refreshHabitStatus().catch(console.warn);
  });
  void api.alarms.get(ALARM).then(alarm => {
    if (!alarm) api.alarms.create(ALARM, { periodInMinutes: 15 });
  }).catch(console.warn);
  void refreshHabitStatus().catch(console.warn);
}
