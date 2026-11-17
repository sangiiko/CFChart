import React, { useState } from 'react';
import { CodePeekError, loadPeers, sourceUrl, type Peer } from '../codePeek';

interface Props {
  contestId: number;
  index: string;
  handle: string;
  /** The viewer's own language for this problem, when their history recorded it. */
  language?: string;
}

export const CodePeekChip: React.FC<Props> = ({ contestId, index, handle, language }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [scanned, setScanned] = useState(0);
  const [family, setFamily] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; blocked: boolean } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    setPeers([]);
    setExpanded(null);
    try {
      const result = await loadPeers(contestId, index, handle, {
        language,
        onPeer: peer => setPeers(current => [...current, peer]),
      });
      setPeers(result.peers);
      setScanned(result.scanned);
      setFamily(result.family);
    } catch (cause) {
      setError({
        message: cause instanceof Error ? cause.message : 'Codeforces did not return a solution.',
        blocked: cause instanceof CodePeekError && cause.code === 'blocked',
      });
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && peers.length === 0 && !error) void load();
  };

  return (
    <div className="cf-codepeek">
      <button
        type="button"
        className="cf-verdict-btn cf-codepeek-chip"
        aria-expanded={open}
        onClick={toggle}
        title="Read the fastest accepted solutions in your language"
      >
        <span>⚡ Fastest solutions</span>
      </button>
      {open && (
        <div className="cf-codepeek-panel">
          <p className="cf-codepeek-note">
            {busy && peers.length === 0
              ? 'Reading the Codeforces status page…'
              : `${scanned} fastest accepted${family ? ` · ${family}` : ''} · you excluded`}
          </p>
          {peers.map(peer => (
            <div key={peer.submissionId} className="cf-codepeek-row">
              <button
                type="button"
                className="cf-codepeek-head"
                aria-expanded={expanded === peer.submissionId}
                onClick={() => setExpanded(current => (current === peer.submissionId ? null : peer.submissionId))}
              >
                <span className="cf-codepeek-handle">{peer.handle}</span>
                <span className="cf-codepeek-meta">
                  {peer.lines} lines · {peer.ms} ms · {peer.language}
                </span>
              </button>
              {expanded === peer.submissionId && (
                <div className="cf-codepeek-body">
                  <div className="cf-codepeek-actions">
                    <button
                      type="button"
                      className="cf-link"
                      onClick={() => void navigator.clipboard?.writeText(peer.source)}
                    >
                      Copy
                    </button>
                    <a className="cf-link" href={sourceUrl(contestId, peer.submissionId)} target="_blank" rel="noreferrer">
                      Open on Codeforces
                    </a>
                  </div>
                  <pre className="cf-codepeek-source">{peer.source}</pre>
                </div>
              )}
            </div>
          ))}
          {busy && peers.length > 0 && <p className="cf-codepeek-note"><span className="cf-spinner" /> Loading more…</p>}
          {error && (
            <p className="cf-codepeek-note" role="alert">
              {error.message}
              {error.blocked || !busy ? <button type="button" className="cf-link" onClick={() => void load()}>Retry</button> : null}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
