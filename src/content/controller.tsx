import { Component, ErrorInfo, ReactNode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { getPreferences, updatePreferences, detectViewer, subscribeToChanges, getPractice, exportPracticeData } from '../services/extensionClient';
import { TopBarHabitPill } from './components/TopBarHabitPill';
import { ProfileHorizonCard } from './components/ProfileHorizonCard';
import { ProblemVerdictBar } from './components/ProblemVerdictBar';
import { ProblemTimerWidget } from './components/ProblemTimerWidget';
import { headerAnchor, profileAnchor, profileHandle, ratingGraph, preserveNativeGraph, viewerHandle, parseProblemPath, problemHeaderAnchor, hasAcceptedVerdictInPage } from './dom';
import type { PracticeLedger } from '../recommender/types';
import { latestEvents } from '../recommender/events';
import contentStyles from './content.css';
import uiTokens from '../ui/tokens.css';

type Preferences = Awaited<ReturnType<typeof getPreferences>>;
interface Mount { host: HTMLElement; root: Root }
class RenderBoundary extends Component<{ children: ReactNode; onFailure?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { this.props.onFailure?.(); }
  render() { return this.state.failed ? <div className="cf-panel cf-notice cf-error" role="alert">CFChart could not render. Reload this page to retry. The original Codeforces graph remains available.</div> : this.props.children; }
}
function createMount(id: string): Mount {
  const host = document.createElement('div'); host.id = id; host.dataset.cfchartHost = 'true';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = uiTokens + contentStyles;
  const app = document.createElement('div'); app.className = 'cf-app'; shadow.append(style, app);
  return { host, root: createRoot(app) };
}

declare global { interface Window { __cfchartDispose?: () => void } }
export function startCFChart() {
  window.__cfchartDispose?.();
  let disposed = false, preferences: Preferences | null = null, header: Mount | null = null, profile: Mount | null = null, problemBar: Mount | null = null;
  let native: ReturnType<typeof preserveNativeGraph> | null = null;
  let observedHandle: string | null = null, observedProblemKey: string | null = null, pending = 0, problemRequestId = 0;
  let viewerChecked = false;
  const showNative = (visible: boolean) => {
    if (!native) {
      const graph = ratingGraph(document);
      if (graph) native = preserveNativeGraph(graph);
    }
    native?.setVisible(visible);
  };
  const removeProfile = () => { native?.restore(); native = null; profile?.root.unmount(); profile?.host.remove(); profile = null; observedHandle = null; };
  const removeProblemBar = () => {
    problemRequestId++;
    problemBar?.root.unmount();
    problemBar?.host.remove();
    problemBar = null;
    observedProblemKey = null;
  };
  const savePreferences = async (changes: Partial<Preferences>) => {
    const saved = await updatePreferences(changes); if (disposed) return;
    preferences = saved; render();
  };
  const render = () => {
    if (disposed || !preferences) return;
    const target = headerAnchor(document);
    if (target && (!header || !header.host.isConnected)) {
      header?.root.unmount(); header?.host.remove();
      header = createMount('cfchart-personal-host');
      header.host.style.cssText = 'display:inline-block;position:relative;margin:6px 0 6px 12px;vertical-align:middle;text-align:left;z-index:1000;';
      target.append(header.host);
    }
    header?.root.render(<RenderBoundary><TopBarHabitPill preferences={preferences} onPreferencesChange={savePreferences} /></RenderBoundary>);
    if (!viewerChecked) {
      const viewer = viewerHandle(document);
      if (viewer) { viewerChecked = true; detectViewer(viewer).then(value => { if (!disposed && JSON.stringify(value) !== JSON.stringify(preferences)) { preferences = value; render(); } }).catch(() => { /* Manual setup remains available. */ }); }
    }
    const handle = profileHandle(location.pathname);
    if (!handle) {
      if (profile) removeProfile();
    } else {
      if (observedHandle && observedHandle !== handle) removeProfile();
      const graph = ratingGraph(document);
      if (graph !== native?.element) { native?.restore(); native = graph ? preserveNativeGraph(graph) : null; }
      const fallback = profileAnchor(document);
      if (graph || fallback) {
        if (!profile || !profile.host.isConnected) {
          profile?.root.unmount(); profile?.host.remove(); profile = createMount('cfchart-profile-host'); observedHandle = handle;
        }
        if (graph?.parentElement) {
          if (profile.host.nextElementSibling !== graph) graph.parentElement.insertBefore(profile.host, graph);
        } else if (fallback?.parentElement) {
          // An unrated profile can have no graph; place after its actual profile box.
          if (fallback.classList.contains('userbox')) { if (fallback.nextElementSibling !== profile.host) fallback.after(profile.host); }
          else if (profile.host.parentElement !== fallback) fallback.prepend(profile.host);
        }
        profile.root.render(<RenderBoundary key={handle} onFailure={() => showNative(true)}><ProfileHorizonCard handle={handle} onNativeVisibilityChange={native?.setVisible ?? showNative} /></RenderBoundary>);
      }
    }

    const problemInfo = parseProblemPath(location.pathname);
    if (problemInfo) {
      const userHandle = preferences.personalHandle ?? '';
      const problemKeyStr = `${problemInfo.contestId}-${problemInfo.index}`;
      const anchor = problemHeaderAnchor(document);
      if (!anchor) {
        removeProblemBar();
      } else {
        // A verdict shown in the page belongs to the signed-in account. History is
        // checked separately for the tracked account when those handles differ.
        const isPageAccepted = viewerHandle(document)?.toLowerCase() === userHandle.toLowerCase()
          && hasAcceptedVerdictInPage(document);
        const requestId = ++problemRequestId;
        const checkAccepted = userHandle
          ? Promise.all([
              getPractice(userHandle).catch(() => null),
              (exportPracticeData(userHandle) as Promise<{ ledger?: PracticeLedger } | null>).catch(() => null),
            ])
          : Promise.resolve([null, null] as const);

        checkAccepted.then(([practice, data]) => {
          if (disposed || requestId !== problemRequestId) return;
          const currentProblem = parseProblemPath(location.pathname);
          if (currentProblem?.contestId !== problemInfo.contestId || currentProblem.index !== problemInfo.index) return;
          const isHistoryAccepted = practice?.submissions.some(
            s => s.verdict === 'OK' && s.problem?.contestId === problemInfo.contestId && s.problem?.index?.toUpperCase() === problemInfo.index
          );
          const isAccepted = isPageAccepted || Boolean(isHistoryAccepted);
          const existingEvent = latestEvents(data?.ledger?.events?.filter(e => e.provenance === 'self-report') ?? []).get(problemKeyStr);
          const initialOutcome = existingEvent?.outcome === 'assisted' ? 'assisted' : existingEvent?.outcome === 'independent' ? 'independent' : null;

          if (!problemBar || !problemBar.host.isConnected || observedProblemKey !== problemKeyStr) {
            problemBar?.root.unmount();
            problemBar?.host.remove();
            problemBar = createMount('cfchart-problem-host');
            problemBar.host.style.cssText = 'display:block;margin:6px 0;text-align:left;';
            if (anchor.classList.contains('title')) {
              anchor.after(problemBar.host);
            } else {
              anchor.append(problemBar.host);
            }
            observedProblemKey = problemKeyStr;
          }
          problemBar.root.render(
            <RenderBoundary>
              <div className="cf-problem-area">
                <ProblemTimerWidget problemKey={problemKeyStr} />
                {isAccepted && userHandle && (
                  <ProblemVerdictBar
                    handle={userHandle}
                    contestId={problemInfo.contestId}
                    index={problemInfo.index}
                    initialOutcome={initialOutcome}
                  />
                )}
              </div>
            </RenderBoundary>
          );
        });
      }
    } else {
      removeProblemBar();
    }
  };
  const schedule = () => { if (!pending && !disposed) pending = window.setTimeout(() => { pending = 0; render(); }, 80); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // CF uses full page navigation. A bounded observer handles delayed graph/header construction.
  const stopObserving = window.setTimeout(() => observer.disconnect(), 30_000);
  // Codeforces can add a submission verdict well after the initial page settles.
  // Keep watching just the problem content and rerender only when acceptance changes.
  const problemContent = parseProblemPath(location.pathname) && document.querySelector('#pageContent');
  let pageAcceptedKnown = hasAcceptedVerdictInPage(document);
  const verdictObserver = new MutationObserver(() => {
    const accepted = hasAcceptedVerdictInPage(document);
    if (accepted !== pageAcceptedKnown) {
      pageAcceptedKnown = accepted;
      schedule();
    }
  });
  if (problemContent) verdictObserver.observe(problemContent, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'],
  });
  window.addEventListener('popstate', schedule);
  const unsubscribe = subscribeToChanges(() => {
    getPreferences().then(value => { if (!disposed && JSON.stringify(value) !== JSON.stringify(preferences)) { preferences = value; render(); } }).catch(() => { /* Visible UI can continue with the last known preferences. */ });
  });
  getPreferences().then(value => { if (!disposed) { preferences = value; render(); } }).catch(error => {
    if (disposed) return;
    const anchor = headerAnchor(document);
    if (anchor) {
      header = createMount('cfchart-personal-host'); anchor.append(header.host);
      header.root.render(<div className="cf-notice cf-error" role="alert">CFChart is unavailable. Reload the extension and this page. {error instanceof Error ? error.message : ''}</div>);
    }
  });
  const dispose = () => {
    if (disposed) return; disposed = true;
    observer.disconnect(); verdictObserver.disconnect(); window.clearTimeout(stopObserving); window.clearTimeout(pending);
    window.removeEventListener('popstate', schedule); unsubscribe();
    header?.root.unmount(); header?.host.remove(); removeProfile(); removeProblemBar();
    if (window.__cfchartDispose === dispose) delete window.__cfchartDispose;
  };
  window.__cfchartDispose = dispose;
  return dispose;
}
