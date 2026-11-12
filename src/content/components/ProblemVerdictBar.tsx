import React, { useState } from 'react';
import { recordPracticeFeedback } from '../../services/extensionClient';
import { loadStoredTimer, saveStoredTimer } from './ProblemTimerWidget';

interface Props {
  handle: string;
  contestId: number;
  index: string;
  initialOutcome?: 'independent' | 'assisted' | null;
}

export const ProblemVerdictBar: React.FC<Props> = ({
  handle,
  contestId,
  index,
  initialOutcome = null,
}) => {
  const [outcome, setOutcome] = useState<'independent' | 'assisted' | null>(initialOutcome);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState(false);

  const save = async (nextOutcome: 'independent' | 'assisted') => {
    if (busy || outcome === nextOutcome) return;
    setBusy(true);
    setMessage('');
    setSaveError(false);
    const problemKey = `${contestId}-${index}`;

    // Read timer elapsed time if available
    const timerState = loadStoredTimer(problemKey);
    let minutes: number | undefined;
    if (timerState.elapsedMs > 0 || timerState.runningSince !== null) {
      const totalElapsed =
        timerState.elapsedMs +
        (timerState.runningSince ? Math.max(0, Date.now() - timerState.runningSince) : 0);
      if (totalElapsed >= 30_000) {
        minutes = Math.max(1, Math.round(totalElapsed / 60000));
      }
    }

    try {
      await recordPracticeFeedback(handle, {
        id: crypto.randomUUID(),
        problemKey,
        outcome: nextOutcome,
        ...(minutes ? { minutes } : {}),
      });
      if (timerState.runningSince !== null) {
        saveStoredTimer({ ...timerState, elapsedMs: timerState.elapsedMs + Math.max(0, Date.now() - timerState.runningSince), runningSince: null });
        window.dispatchEvent(new CustomEvent('cfchart:timer-saved-outcome', { detail: { problemKey } }));
      }
      setOutcome(nextOutcome);
      const minText = minutes ? ` (${minutes} mins)` : '';
      setMessage(nextOutcome === 'assisted' ? `Saved${minText} · Review scheduled` : `Saved${minText} on this device`);
    } catch {
      setSaveError(true);
      setMessage('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cf-problem-verdict-bar" role="group" aria-label="Record problem outcome">
      <span className="cf-verdict-label">Record outcome</span>
      <button
        type="button"
        className={`cf-verdict-btn ${outcome === 'independent' ? 'is-solved' : ''}`}
        disabled={busy || outcome === 'independent'}
        aria-pressed={outcome === 'independent'}
        onClick={() => save('independent')}
        title="Mark as solved independently"
      >
        <span>Solved</span>
      </button>
      <button
        type="button"
        className={`cf-verdict-btn ${outcome === 'assisted' ? 'is-assisted' : ''}`}
        disabled={busy || outcome === 'assisted'}
        aria-pressed={outcome === 'assisted'}
        onClick={() => save('assisted')}
        title="Mark as solved with help (schedules review)"
      >
        <span>Solved with help</span>
      </button>
      {message && <span className="cf-verdict-status" role={saveError ? 'alert' : 'status'}>{message}</span>}
    </div>
  );
};
