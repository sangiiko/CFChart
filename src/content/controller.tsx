import { Component, ErrorInfo, ReactNode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { getPreferences, updatePreferences, detectViewer, subscribeToChanges, getPractice, exportPracticeData } from '../services/extensionClient';
import { TopBarHabitPill } from './components/TopBarHabitPill';
import { ProfileHorizonCard } from './components/ProfileHorizonCard';
import { ProblemVerdictBar } from './components/ProblemVerdictBar';
import { ProblemTimerWidget } from './components/ProblemTimerWidget';
import { CodePeekChip } from './components/CodePeekChip';
import { headerAnchor, profileAnchor, profileHandle, ratingGraph, preserveNativeGraph, viewerHandle, parseProblemPath, problemHeaderAnchor, hasAcceptedVerdictInPage, peekingEnabled } from './dom';
import type { PracticeLedger } from '../recommender/types';
import { latestEvents } from '../recommender/events';
import { evaluateReviewState } from '../recommender/retention';
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
  let checkedProblemSignature: string | null = null, problemCheckDirty = false;
  let syncedAcceptedKey: string | null = null;
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
    checkedProblemSignature = null;
    problemCheckDirty = false;
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
          && hasAcceptedVerdictInPage(document, problemInfo);
        const signature = `${problemKeyStr}:${userHandle}:${isPageAccepted}`;
        const mountProblemBar = () => {
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
            return true;
          }
          return false;
        };
        const freshlyMounted = mountProblemBar();
        if (freshlyMounted) {
          problemCheckDirty = true;
          problemBar!.root.render(
            <RenderBoundary>
              <div className="cf-problem-area">
                <ProblemTimerWidget problemKey={problemKeyStr} handle={userHandle || undefined} />
              </div>
            </RenderBoundary>
          );
        }
        if (checkedProblemSignature === signature && !problemCheckDirty) {
          return;
        }
        checkedProblemSignature = signature;
        problemCheckDirty = false;
        const requestId = ++problemRequestId;
        let resolvedPractice: Awaited<ReturnType<typeof getPractice>> | null = null;
        let resolvedData: { ledger?: PracticeLedger } | null = null;
        let practiceSettled = !userHandle;
        let dataSettled = !userHandle;

        const renderVerdictState = () => {
          if (disposed || requestId !== problemRequestId) return;
          const currentProblem = parseProblemPath(location.pathname);
          if (currentProblem?.contestId !== problemInfo.contestId || currentProblem.index !== problemInfo.index) return;
          const ledgerEvents = resolvedData?.ledger?.events ?? [];
          const isHistoryAccepted = resolvedPractice?.submissions.some(
            s => s.verdict === 'OK' && (s.problem?.contestId === problemInfo.contestId || s.contestId === problemInfo.contestId) && s.problem?.index?.toUpperCase() === problemInfo.index
          );
          const isLedgerAccepted = ledgerEvents.some(
            e => e.problemKey === problemKeyStr && ['accepted', 'independent', 'assisted', 'already-solved'].includes(e.outcome)
          );
          const isAccepted = isPageAccepted || Boolean(isHistoryAccepted) || isLedgerAccepted;
          if (!isAccepted && !practiceSettled) return;
          // The newest accepted submission carries the language the viewer actually used.
          const ownLanguage = resolvedPractice?.submissions.find(
            s => s.verdict === 'OK' && s.problem?.index?.toUpperCase() === problemInfo.index
              && (s.problem?.contestId === problemInfo.contestId || s.contestId === problemInfo.contestId)
          )?.programmingLanguage;

          if (isPageAccepted && practiceSettled && !isHistoryAccepted && userHandle) {
            const syncKey = `${problemKeyStr}:${userHandle}`;
            if (syncedAcceptedKey !== syncKey) {
              syncedAcceptedKey = syncKey;
              void getPractice(userHandle, { force: true }).catch(() => {});
            }
          }
          const existingEvent = latestEvents(ledgerEvents.filter(e => e.provenance === 'self-report')).get(problemKeyStr);
          const reviewStatus = evaluateReviewState(problemKeyStr, ledgerEvents, Date.now());
          const isSameDaySelfReport = existingEvent
            ? new Date(existingEvent.timestamp).toDateString() === new Date().toDateString()
            : false;
          const isReview = reviewStatus.awaitingReview && !isSameDaySelfReport;
          const initialOutcome = isReview
            ? null
            : existingEvent?.outcome === 'assisted'
              ? 'assisted'
              : existingEvent?.outcome === 'independent'
                ? 'independent'
                : existingEvent?.outcome === 'already-solved'
                  ? 'already-solved'
                  : null;

          mountProblemBar();
          problemBar!.root.render(
            <RenderBoundary>
              <div className="cf-problem-area">
                <ProblemTimerWidget problemKey={problemKeyStr} handle={userHandle || undefined} />
                {isAccepted && userHandle && (
                  <ProblemVerdictBar
                    handle={userHandle}
                    contestId={problemInfo.contestId}
                    index={problemInfo.index}
                    initialOutcome={initialOutcome}
                    isReview={isReview}
                  />
                )}
                {isAccepted && userHandle && peekingEnabled(document, problemInfo.contestId) && (
                  <CodePeekChip
                    contestId={problemInfo.contestId}
                    index={problemInfo.index}
                    handle={userHandle}
                    language={ownLanguage}
                  />
                )}
              </div>
            </RenderBoundary>
          );
        };

        if (!userHandle) {
          renderVerdictState();
        } else {
          void (exportPracticeData(userHandle) as Promise<{ ledger?: PracticeLedger } | null>)
            .catch(() => null)
            .then(data => {
              resolvedData = data;
              dataSettled = true;
              renderVerdictState();
            });
          void getPractice(userHandle)
            .catch(() => null)
            .then(practice => {
              resolvedPractice = practice;
              practiceSettled = true;
              if (dataSettled) renderVerdictState();
            });
        }
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
  // Codeforces can add a submission verdict well after the initial page settles
  // (including in the sidebar "Last submissions" table).
  // Keep watching problem content and sidebar and rerender only when acceptance changes.
  const initialProblem = parseProblemPath(location.pathname);
  const problemContent = initialProblem && document.querySelector('#pageContent');
  const problemSidebar = initialProblem && document.querySelector('#sidebar');
  let pageAcceptedKnown = hasAcceptedVerdictInPage(document, initialProblem ?? undefined);
  const verdictObserver = new MutationObserver(() => {
    const currentProblem = parseProblemPath(location.pathname);
    const accepted = hasAcceptedVerdictInPage(document, currentProblem ?? undefined);
    if (accepted !== pageAcceptedKnown) {
      pageAcceptedKnown = accepted;
      schedule();
    }
  });
  const observerOpts = {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'],
  };
  if (problemContent) verdictObserver.observe(problemContent, observerOpts);
  if (problemSidebar) verdictObserver.observe(problemSidebar, observerOpts);
  window.addEventListener('popstate', schedule);
  const unsubscribe = subscribeToChanges(changedKeys => {
    const handleKey = preferences?.personalHandle?.toLowerCase();
    if (handleKey && (!changedKeys || changedKeys.some(k => k === `cfchart:learning:${handleKey}` || k === `cfchart:practice:${handleKey}`))) {
      problemCheckDirty = true;
    }
    getPreferences().then(value => {
      if (disposed) return;
      const prefsChanged = JSON.stringify(value) !== JSON.stringify(preferences);
      if (prefsChanged || problemCheckDirty) {
        preferences = value;
        render();
      }
    }).catch(() => { /* Visible UI can continue with the last known preferences. */ });
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
