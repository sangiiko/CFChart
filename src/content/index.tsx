import { createRoot, Root } from 'react-dom/client';
import browser from 'webextension-polyfill';
import { storageService } from '../services/storage';
import { codeforcesApi } from '../services/codeforcesApi';
import { calculateHabitProgress } from '../services/habitTracker';
import { TopBarHabitPill } from './components/TopBarHabitPill';
import { ProfileHorizonCard } from './components/ProfileHorizonCard';
import '../index.css';

console.log('[CFChart] Content script loaded on:', window.location.href);

let topBarRoot: Root | null = null;
let profileRoot: Root | null = null;

function detectHandleFromDOM(): string | null {
  // 1. From URL pathname: e.g. /profile/Sangiiko
  const urlMatch = window.location.pathname.match(/\/profile\/([a-zA-Z0-9_.-]+)/i);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }

  // 2. From page title: e.g. "Sangiiko - Codeforces"
  const titleMatch = document.title.match(/^([a-zA-Z0-9_.-]+)\s*-\s*Codeforces/i);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1];
  }

  // 3. From header profile links
  const links = document.querySelectorAll<HTMLAnchorElement>('a[href^="/profile/"]');
  for (const link of Array.from(links)) {
    const text = link.textContent?.trim();
    if (text && !text.includes('Enter') && !text.includes('Register') && !text.includes('Logout')) {
      return text;
    }
  }

  return null;
}

function detectRatingFromPage(): number {
  // Try to find rating text in profile info box
  // e.g. "Contest rating: 1199"
  const text = document.body.innerText || '';
  const match = text.match(/Contest rating:\s*(\d+)/i);
  if (match && match[1]) {
    const r = parseInt(match[1], 10);
    if (!isNaN(r) && r > 0) return r;
  }
  return 1200;
}

function mountTopBarPill(handle: string, progress: any, recommended: any[]) {
  try {
    let mount = document.getElementById('cfchart-topbar-root');
    if (!mount) {
      // Find header container
      const target =
        document.querySelector('.lang-chooser') ||
        document.querySelector('#header .lang-chooser') ||
        document.querySelector('#header') ||
        document.querySelector('.main-menu-list') ||
        document.body;

      mount = document.createElement('div');
      mount.id = 'cfchart-topbar-root';
      mount.style.display = 'inline-block';
      mount.style.marginLeft = '12px';
      mount.style.verticalAlign = 'middle';
      mount.style.position = 'relative';

      if (target === document.body) {
        mount.style.position = 'fixed';
        mount.style.top = '10px';
        mount.style.right = '15px';
        mount.style.zIndex = '99999';
        document.body.appendChild(mount);
      } else {
        target.prepend(mount);
      }

      topBarRoot = createRoot(mount);
    }

    if (topBarRoot) {
      topBarRoot.render(
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
  } catch (err) {
    console.warn('[CFChart] Error mounting TopBar pill:', err);
  }
}

function mountProfileHorizon(
  handle: string,
  currentRating: number,
  ratingHistory: any[],
  habitProgress: any,
  isLoading: boolean
) {
  try {
    let mount = document.getElementById('cfchart-profile-mount');
    if (!mount) {
      // Look for Flot graph placeholder or wrappers
      const placeholder = document.getElementById('placeholder');
      const userRatingGraphHolder =
        document.querySelector('.userRatingGraphHolder') ||
        document.querySelector('#userRatingGraphHolder') ||
        document.querySelector('.roundbox');
      const pageContent =
        document.getElementById('pageContent') ||
        document.querySelector('.content') ||
        document.querySelector('.main-content') ||
        document.body;

      mount = document.createElement('div');
      mount.id = 'cfchart-profile-mount';

      if (placeholder && placeholder.parentElement) {
        placeholder.parentElement.insertBefore(mount, placeholder);
        console.log('[CFChart] Mounted before #placeholder');
      } else if (userRatingGraphHolder && userRatingGraphHolder.parentElement) {
        userRatingGraphHolder.parentElement.insertBefore(mount, userRatingGraphHolder);
        console.log('[CFChart] Mounted before userRatingGraphHolder');
      } else if (pageContent) {
        pageContent.prepend(mount);
        console.log('[CFChart] Mounted into pageContent');
      }

      profileRoot = createRoot(mount);
    }

    if (profileRoot) {
      profileRoot.render(
        <ProfileHorizonCard
          handle={handle}
          currentRating={currentRating}
          ratingHistory={ratingHistory}
          habitProgress={habitProgress}
          isLoading={isLoading}
        />
      );
    }
  } catch (err) {
    console.warn('[CFChart] Error mounting Profile Horizon card:', err);
  }
}

async function runCFChart() {
  const isProfilePage = window.location.pathname.toLowerCase().includes('/profile/');
  const detectedHandle = detectHandleFromDOM() || 'tourist';
  const initialRating = detectRatingFromPage();

  console.log(`[CFChart] Active for @${detectedHandle} (Profile page: ${isProfilePage})`);

  // Initial immediate placeholder progress so user sees UI instantly
  const initialProgress = {
    dailyTarget: 2,
    todayCount: 0,
    isTodayTargetMet: false,
    todayProblems: [],
    currentStreak: 0,
    recentDays: [],
    lastUpdated: Date.now(),
  };

  // 1. Mount TopBar Pill immediately
  mountTopBarPill(detectedHandle, initialProgress, []);

  // 2. If on profile page, mount Horizon Card immediately (with initial rating from page)
  if (isProfilePage) {
    mountProfileHorizon(detectedHandle, initialRating, [], initialProgress, true);
  }

  // 3. Asynchronously fetch latest data from Codeforces API
  try {
    const [userInfo, ratingHistory, submissions] = await Promise.all([
      codeforcesApi.fetchUserInfo(detectedHandle),
      codeforcesApi.fetchUserRatingHistory(detectedHandle),
      codeforcesApi.fetchUserSubmissions(detectedHandle, 150),
    ]);

    const activeRating = userInfo?.rating || initialRating || 1200;
    const habitProgress = calculateHabitProgress(submissions, 2);
    const solvedKeys = new Set(
      submissions.filter(s => s.verdict === 'OK').map(s => `${s.problem.contestId}-${s.problem.index}`)
    );
    const recommended = await codeforcesApi.fetchRecommendedProblems(activeRating, solvedKeys);

    // Cache locally
    await storageService.set('cf_handle', detectedHandle);
    await storageService.set('cf_user', userInfo);
    await storageService.set('cf_ratings', ratingHistory);
    await storageService.set('cf_submissions', submissions);

    // Update extension badge
    try {
      if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
        browser.runtime.sendMessage({
          type: 'UPDATE_HABIT_BADGE',
          count: habitProgress.todayCount,
          target: habitProgress.dailyTarget,
        });
      }
    } catch {
      // Ignore
    }

    // Update mounted UI with live data
    mountTopBarPill(detectedHandle, habitProgress, recommended);
    if (isProfilePage) {
      mountProfileHorizon(detectedHandle, activeRating, ratingHistory, habitProgress, false);
    }
  } catch (err) {
    console.warn('[CFChart] Error syncing live data, staying on initial render:', err);
    if (isProfilePage) {
      mountProfileHorizon(detectedHandle, initialRating, [], initialProgress, false);
    }
  }
}

// Execute immediately when DOM is ready, or retry once if elements are still attaching
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => runCFChart());
} else {
  runCFChart();
}

// Fallback check after 500ms in case Codeforces delayed rendering #placeholder
setTimeout(() => {
  if (window.location.pathname.toLowerCase().includes('/profile/') && !document.getElementById('cfchart-profile-mount')) {
    console.log('[CFChart] Retrying mount on delayed profile page');
    runCFChart();
  }
}, 600);
