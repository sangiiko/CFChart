import { useState } from 'react';
import type { RecommendedProblem } from '../types/codeforces';
import type { PracticeOutcome } from '../recommender/types';
import { recordPracticeFeedback } from '../services/extensionClient';

function PracticeCard({ handle, problem }: { handle: string; problem: RecommendedProblem }) {
  const [outcome, setOutcome] = useState<PracticeOutcome>(problem.slot === 'guided' ? 'assisted' : 'independent');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  return (
    <article className="practice-task">
      <a href={problem.url} target="_blank" rel="noreferrer">
        <small>
          {problem.slotLabel} · {problem.rating}
        </small>
        <strong>
          {problem.contestId}
          {problem.index}. {problem.name} ↗
        </strong>
      </a>
      {saved ? (
        <p role="status">Result saved on this device.</p>
      ) : (
        <form
          onSubmit={async event => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              await recordPracticeFeedback(handle, {
                id: crypto.randomUUID(),
                problemKey: `${problem.contestId}-${problem.index}`,
                outcome,
              });
              setSaved(true);
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Could not save result.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Practice result
            <select value={outcome} onChange={e => setOutcome(e.target.value as PracticeOutcome)}>
              <option value="independent">Solved</option>
              <option value="assisted">Solved with help</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save result'}
            </button>
            <button
              type="button"
              className="cf-link"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await recordPracticeFeedback(handle, {
                    id: crypto.randomUUID(),
                    problemKey: `${problem.contestId}-${problem.index}`,
                    outcome: 'skipped',
                  });
                  setSaved(true);
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : 'Could not skip task.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Skip task
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}

export function PracticeRecommendations({
  handle,
  recommendations,
}: {
  handle: string;
  recommendations: RecommendedProblem[];
  budget?: number;
}) {
  return (
    <section className="practice-session" aria-label="Practice session">
      {recommendations.length ? (
        recommendations.map(problem => (
          <PracticeCard key={`${handle}:${problem.contestId}-${problem.index}`} handle={handle} problem={problem} />
        ))
      ) : (
        <p className="cf-empty">No tasks remain within today's goal and suitable difficulty range.</p>
      )}
    </section>
  );
}
