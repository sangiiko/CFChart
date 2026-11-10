import { createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';
import { storageService } from '../services/storage';
import { codeforcesApi } from '../services/codeforcesApi';
import { calculateHabitProgress } from '../services/habitTracker';
import { TopBarHabitPill } from './components/TopBarHabitPill';
import { ProfileHorizonCard } from './components/ProfileHorizonCard';
import '../index.css';

// Extract logged-in handle from Codeforces DOM
function detectLoggedInHandle(): string | null {
  // CF typically has header links: e.g. <a href="/profile/handle">handle</a>
  const profileLinks = document.querySelectorAll<HTMLAnchorElement>('#header a[href^="/profile/"]');
  for (const link of Array.from(profileLinks)) {
    const text = link.textContent?.trim();
    if (text && !text.includes('Enter') && !text.includes('Register')) {
      return text;
    }
  }

  // Check URL if on profile page: /profile/<handle>
  const pathMatch = window.location.pathname.match(/\/profile\/([a-zA-Z0-9_.-]+)/);
  if (pathMatch && pathMatch[1]) {
    return pathMatch[1];
  }

  return null;
}

// Extract handle of current profile page
function getCurrentProfilePageHandle(): string | null {
  const match = window.location.pathname.match(/\/profile\/([a-zA-Z0-9_.-]+)/);
  return match ? match[1] : null;
}

async function initCFChart() {
  try {
    let handle = detectLoggedInHandle();
    const storedHandle = await storageService.get('cf_handle');

    if (!handle && storedHandle) {
      handle = storedHandle;
    } else if (handle && handle !== storedHandle) {
      await storageService.set('cf_handle', handle);
    }

    if (!handle) {
      // Default to tourist as sample if unauthenticated/unconnected
      handle = 'tourist';
    }

    // Fetch user data
    const [userInfo, ratingHistory, submissions] = await Promise.all([
      codeforcesApi.fetchUserInfo(handle),
      codeforcesApi.fetchUserRatingHistory(handle),
      codeforcesApi.fetchUserSubmissions(handle, 150),
    ]);

    const habitProgress = calculateHabitProgress(submissions, 2);
    const solvedKeys = new Set(submissions.filter(s => s.verdict === 'OK').map(s => `${s.problem.contestId}-${s.problem.index}`));
    const recommended = await codeforcesApi.fetchRecommendedProblems(userInfo?.rating || 1200, solvedKeys);

    // Save to storage
    await storageService.set('cf_user', userInfo);
    await storageService.set('cf_ratings', ratingHistory);
    await storageService.set('cf_submissions', submissions);

    // Update browser badge if runtime is available
    try {
      if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
        browser.runtime.sendMessage({
          type: 'UPDATE_HABIT_BADGE',
          count: habitProgress.todayCount,
          target: habitProgress.dailyTarget,
        });
      }
    } catch {
      // Ignore outside extension context
    }

    // 1. Inject TopBar Habit Pill into Codeforces Header
    injectTopBarPill(handle, habitProgress, recommended);

    // 2. Inject Profile Horizon Card if on a profile page
    const pageHandle = getCurrentProfilePageHandle() || handle;
    if (window.location.pathname.includes('/profile/')) {
      injectProfileHorizon(pageHandle, userInfo?.rating || 1200, ratingHistory, habitProgress);
    }
  } catch (err) {
    console.error('CFChart injection error:', err);
  }
}

function injectTopBarPill(
  handle: string,
  progress: any,
  recommended: any[]
) {
  const existing = document.getElementById('cfchart-topbar-root');
  if (existing) existing.remove();

  // Find suitable injection container in CF header
  const headerContainer = document.querySelector('#header .lang-chooser') || document.querySelector('#header');
  if (!headerContainer) return;

  const mountDiv = document.createElement('div');
  mountDiv.id = 'cfchart-topbar-root';
  mountDiv.style.display = 'inline-block';
  mountDiv.style.marginLeft = '12px';
  mountDiv.style.verticalAlign = 'middle';

  headerContainer.prepend(mountDiv);

  const root = createRoot(mountDiv);
  root.render(
    <TopBarHabitPill
      progress={progress}
      recommended={recommended}
      handle={handle}
      onOpenProfileHorizon={() => {
        window.location.href = `/profile/${encodeURIComponent(handle)}`;
      }}
    />
  );
}

function injectProfileHorizon(
  handle: string,
  currentRating: number,
  ratingHistory: any[],
  habitProgress: any
) {
  const existing = document.getElementById('cfchart-profile-mount');
  if (existing) existing.remove();

  // Locate the rating graph in Codeforces profile page
  // Codeforces has: <div id="pageContent"> ... or near #placeholder
  const targetContainer =
    document.querySelector('#placeholder')?.parentElement ||
    document.querySelector('.roundbox .datatable')?.parentElement ||
    document.querySelector('#pageContent');

  if (!targetContainer) return;

  const mountDiv = document.createElement('div');
  mountDiv.id = 'cfchart-profile-mount';

  // Insert before placeholder or at the top of content
  const placeholder = document.getElementById('placeholder');
  if (placeholder && placeholder.parentElement) {
    placeholder.parentElement.insertBefore(mountDiv, placeholder);
  } else {
    targetContainer.prepend(mountDiv);
  }

  const root = createRoot(mountDiv);
  root.render(
    <ProfileHorizonCard
      handle={handle}
      currentRating={currentRating}
      ratingHistory={ratingHistory}
      habitProgress={habitProgress}
    />
  );
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initCFChart());
} else {
  initCFChart();
}
