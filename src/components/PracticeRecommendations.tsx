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
      <div className="practice-task-meta"><span>{problem.slotLabel}</span><span>Rating {problem.rating}</span><span>Planned {problem.plannedMinutes} min</span></div>
      <h3>{problem.contestId}{problem.index}. {problem.name}</h3>
      {problem.reasons[0] && <p className="practice-task-reason">{problem.reasons[0]}</p>}
      <a className="practice-task-open" href={problem.url} target="_blank" rel="noreferrer">Open problem <span aria-hidden="true">↗</span></a>
      {saved ? (
        <p className="practice-task-saved" role="status">Result saved on this device.</p>
      ) : (
        <details className="practice-task-outcome"><summary>Record outcome</summary><form
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
          <div className="practice-task-actions">
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
        </form></details>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}

export function PracticeRecommendations({
  handle,
  recommendations,
  expandedByDefault = false,
}: {
  handle: string;
  recommendations: RecommendedProblem[];
  budget?: number;
  expandedByDefault?: boolean;
}) {
  const [showAll, setShowAll] = useState(expandedByDefault);
  return (
    <section className="practice-session" aria-label="Practice session">
      {recommendations.length ? (
        <>
        <div className="practice-session-heading"><h2>Next problem</h2><span>{recommendations.length} available</span></div>
        {(showAll ? recommendations : recommendations.slice(0, 1)).map(problem => (
          <PracticeCard key={`${handle}:${problem.contestId}-${problem.index}`} handle={handle} problem={problem} />
        ))}
        {recommendations.length > 1 && <button type="button" className="practice-more-button" onClick={() => setShowAll(value => !value)} aria-expanded={showAll}>{showAll ? 'Show one problem' : `See ${recommendations.length - 1} more choices`}</button>}
        </>
      ) : (
        <p className="cf-empty">No tasks remain within today's goal and suitable difficulty range.</p>
      )}
    </section>
  );
}
