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

  const save = async (nextOutcome: 'independent' | 'assisted') => {
    if (busy) return;
    setBusy(true);
    setMessage('');
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
      // Stop/pause timer since user has submitted and confirmed outcome
      saveStoredTimer({
        ...timerState,
        elapsedMs: totalElapsed,
        runningSince: null,
      });
    }

    try {
      await recordPracticeFeedback(handle, {
        id: crypto.randomUUID(),
        problemKey,
        outcome: nextOutcome,
        ...(minutes ? { minutes } : {}),
      });
      setOutcome(nextOutcome);
      const minText = minutes ? ` (${minutes} mins)` : '';
      setMessage(
        nextOutcome === 'assisted'
          ? `Saved${minText} — review scheduled`
          : `Saved${minText}`
      );
      setTimeout(() => setMessage(''), 3000);
    } catch {
      setMessage('Could not save');
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cf-problem-verdict-bar" aria-label="CFChart problem outcome">
      <button
        type="button"
        className={`cf-verdict-btn ${outcome === 'independent' ? 'is-solved' : ''}`}
        disabled={busy}
        onClick={() => save('independent')}
        title="Mark as solved independently"
      >
        <span>✓</span>
        <span>Solved</span>
      </button>
      <button
        type="button"
        className={`cf-verdict-btn ${outcome === 'assisted' ? 'is-assisted' : ''}`}
        disabled={busy}
        onClick={() => save('assisted')}
        title="Mark as solved with help (schedules review)"
      >
        <span>💡</span>
        <span>Solved with help</span>
      </button>
      {message && <span className="cf-verdict-status" role="status">{message}</span>}
    </div>
  );
};
