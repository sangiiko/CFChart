import { useEffect, useRef, useState } from 'react';
import type { RecommendedProblem } from '../types/codeforces';
import { recordPracticeImpressions } from '../services/extensionClient';

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
  handle,
  expandedByDefault = false,
}: {
  recommendations: RecommendedProblem[];
  handle?: string;
  expandedByDefault?: boolean;
}) {
  const [showAll, setShowAll] = useState(expandedByDefault);
  const sectionRef = useRef<HTMLElement>(null);
  const shown = showAll ? recommendations : recommendations.slice(0, 1);
  useEffect(() => {
    if (!handle || !sectionRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      const date = new Date();
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      void recordPracticeImpressions(handle, shown.map(problem => `${problem.contestId}-${problem.index}`), day).catch(() => {});
      observer.disconnect();
    }, { threshold: 0.1 });
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, [handle, recommendations, showAll]);
  return (
    <section ref={sectionRef} className="practice-session" aria-label="Practice session">
      {recommendations.length ? (
        <>
          <div className="practice-session-heading"><h2>Next problem</h2><span>{recommendations.length} available</span></div>
          {shown.map(problem => (
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
