import React, { useState } from 'react';
import { recordPracticeFeedback } from '../../services/extensionClient';

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
    try {
      await recordPracticeFeedback(handle, {
        id: crypto.randomUUID(),
        problemKey: `${contestId}-${index}`,
        outcome: nextOutcome,
      });
      setOutcome(nextOutcome);
      setMessage(nextOutcome === 'assisted' ? 'Saved (review scheduled)' : 'Saved');
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
