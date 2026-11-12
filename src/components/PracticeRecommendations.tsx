import { useState } from 'react';
import type { RecommendedProblem } from '../types/codeforces';

function PracticeCard({ problem }: { problem: RecommendedProblem }) {
  return (
    <article className="practice-task">
      <div className="practice-task-meta"><span>{problem.slotLabel}</span><span>Rating {problem.rating}</span><span>Planned {problem.plannedMinutes} min</span></div>
      <h3>{problem.contestId}{problem.index}. {problem.name}</h3>
      {problem.reasons[0] && <p className="practice-task-reason">{problem.reasons[0]}</p>}
      <a className="practice-task-open" href={problem.url} target="_blank" rel="noreferrer">Open problem <span aria-hidden="true">↗</span></a>
    </article>
  );
}

export function PracticeRecommendations({
  recommendations,
  expandedByDefault = false,
}: {
  recommendations: RecommendedProblem[];
  expandedByDefault?: boolean;
}) {
  const [showAll, setShowAll] = useState(expandedByDefault);
  return (
    <section className="practice-session" aria-label="Practice session">
      {recommendations.length ? (
        <>
          <div className="practice-session-heading"><h2>Next problem</h2><span>{recommendations.length} available</span></div>
          {(showAll ? recommendations : recommendations.slice(0, 1)).map(problem => (
            <PracticeCard key={`${problem.contestId}-${problem.index}`} problem={problem} />
          ))}
          {recommendations.length > 1 && <button type="button" className="practice-more-button" onClick={() => setShowAll(value => !value)} aria-expanded={showAll}>{showAll ? 'Show one problem' : `See ${recommendations.length - 1} more choices`}</button>}
        </>
      ) : (
        <p className="cf-empty">No tasks remain within today's goal and suitable difficulty range.</p>
      )}
    </section>
  );
}
