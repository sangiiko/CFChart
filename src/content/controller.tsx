import { Component, ErrorInfo, ReactNode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { getPreferences, updatePreferences, detectViewer, subscribeToChanges } from '../services/extensionClient';
import { TopBarHabitPill } from './components/TopBarHabitPill';
import { ProfileHorizonCard } from './components/ProfileHorizonCard';
import { headerAnchor, profileAnchor, profileHandle, ratingGraph, preserveNativeGraph, viewerHandle } from './dom';
import contentStyles from './content.css';

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
  const style = document.createElement('style'); style.textContent = contentStyles;
  const app = document.createElement('div'); app.className = 'cf-app'; shadow.append(style, app);
  return { host, root: createRoot(app) };
}

declare global { interface Window { __cfchartDispose?: () => void } }
export function startCFChart() {
  window.__cfchartDispose?.();
  let disposed = false, preferences: Preferences | null = null, header: Mount | null = null, profile: Mount | null = null;
  let native: ReturnType<typeof preserveNativeGraph> | null = null;
  let observedHandle: string | null = null, pending = 0;
  let viewerChecked = false;
  const showNative = (visible: boolean) => native?.setVisible(visible);
  const removeProfile = () => { native?.restore(); native = null; profile?.root.unmount(); profile?.host.remove(); profile = null; observedHandle = null; };
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
    if (!handle) { if (profile) removeProfile(); return; }
    if (observedHandle && observedHandle !== handle) removeProfile();
    const graph = ratingGraph(document);
    if (graph !== native?.element) { native?.restore(); native = graph ? preserveNativeGraph(graph) : null; }
    const fallback = profileAnchor(document);
    if (!graph && !fallback) return;
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
    profile.root.render(<RenderBoundary key={handle} onFailure={() => showNative(true)}><ProfileHorizonCard handle={handle} preferences={preferences} nativeAvailable={!!graph} onPreferencesChange={savePreferences} onNativeVisibilityChange={native?.setVisible ?? showNative} /></RenderBoundary>);
  };
  const schedule = () => { if (!pending && !disposed) pending = window.setTimeout(() => { pending = 0; render(); }, 80); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // CF uses full page navigation. A bounded observer handles delayed graph/header construction.
  const stopObserving = window.setTimeout(() => observer.disconnect(), 30_000);
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
    observer.disconnect(); window.clearTimeout(stopObserving); window.clearTimeout(pending);
    window.removeEventListener('popstate', schedule); unsubscribe();
    header?.root.unmount(); header?.host.remove(); removeProfile();
    if (window.__cfchartDispose === dispose) delete window.__cfchartDispose;
  };
  window.__cfchartDispose = dispose;
  return dispose;
}
