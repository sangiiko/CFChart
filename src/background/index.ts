import browser from 'webextension-polyfill';
import { storageService } from '../services/storage';
import { codeforcesApi } from '../services/codeforcesApi';
import { calculateHabitProgress } from '../services/habitTracker';

async function updateBadge(count: number, target: number = 2) {
  try {
    let text = `${count}/${target}`;
    let color = '#64748b'; // slate grey

    if (count >= target) {
      text = '✓';
      color = '#10b981'; // green
    } else if (count > 0) {
      color = '#0284c7'; // sky blue
    }

    if (browser.action && browser.action.setBadgeText) {
      await browser.action.setBadgeText({ text });
      await browser.action.setBadgeBackgroundColor({ color });
    }
  } catch (err) {
    console.error('Failed to set badge text:', err);
  }
}

async function refreshHabitStatus() {
  const handle = await storageService.get('cf_handle');
  if (!handle) {
    await updateBadge(0, 2);
    return;
  }

  try {
    const submissions = await codeforcesApi.fetchUserSubmissions(handle, 100);
    const progress = calculateHabitProgress(submissions, 2);
    await updateBadge(progress.todayCount, progress.dailyTarget);
  } catch (err) {
    console.warn('Background check failed:', err);
  }
}

// Set up periodic alarm every 30 minutes
try {
  browser.alarms.create('cfchart_sync_alarm', {
    periodInMinutes: 30,
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'cfchart_sync_alarm') {
      refreshHabitStatus();
    }
  });
} catch (err) {
  console.warn('Alarms not supported in current environment', err);
}

// Listen for message updates from content script or popup
try {
  browser.runtime.onMessage.addListener((message: any) => {
    if (message?.type === 'UPDATE_HABIT_BADGE') {
      updateBadge(message.count, message.target);
    } else if (message?.type === 'REFRESH_NOW') {
      refreshHabitStatus();
    }
  });
} catch {
  // Ignore
}

// Initial check on load
refreshHabitStatus();
