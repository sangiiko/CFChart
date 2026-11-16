import { useEffect, useRef, useState } from 'react';
import type { RecommendedProblem } from '../types/codeforces';
import type { PracticeOutcome } from '../recommender/types';
import { recordPracticeFeedback, recordPracticeImpressions } from '../services/extensionClient';

function PracticeCard({
  problem,
  handle,
  onResolved,
}: {
  problem: RecommendedProblem;
  handle?: string;
  onResolved?: (problemKey: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isRevisit = problem.slot === 'revisit';
  const key = `${problem.contestId}-${problem.index}`;

  const handleReviewAction = async (outcome: PracticeOutcome) => {
    if (!handle || busy) return;
    setBusy(true);
    setError('');
    try {
      await recordPracticeFeedback(handle, {
        id: crypto.randomUUID(),
        problemKey: key,
        outcome,
      });
      onResolved?.(key);
    } catch {
      setError('Could not update review status. Try again.');
      setBusy(false);
    }
  };

  return (
    <article className={`practice-task${isRevisit ? ' practice-task--revisit' : ''}`}>
      <div className="practice-task-meta">
        <span className={isRevisit ? 'practice-task-badge practice-task-badge--revisit' : 'practice-task-badge'}>
          {problem.slotLabel}
        </span>
        <span>Rating {problem.rating}</span>
        <span>Planned {problem.plannedMinutes} min</span>
      </div>
      <h3>
        {problem.contestId}
        {problem.index}. {problem.name}
      </h3>
      {problem.reasons[0] && <p className="practice-task-reason">{problem.reasons[0]}</p>}
      <div className="practice-task-actions">
        <a className="practice-task-open" href={problem.url} target="_blank" rel="noreferrer">
          Open problem <span aria-hidden="true">↗</span>
        </a>
        {isRevisit && handle && (
          <div className="practice-review-controls" role="group" aria-label="Review actions">
            <button
              type="button"
              className="practice-review-btn"
              disabled={busy}
              onClick={() => void handleReviewAction('independent')}
              title="Mark review as completed independently"
            >
              Mark reviewed
            </button>
            <button
              type="button"
              className="practice-review-btn"
              disabled={busy}
              onClick={() => void handleReviewAction('skipped')}
              title="Postpone this review for 7 days"
            >
              Snooze 7d
            </button>
            <button
              type="button"
              className="practice-review-btn practice-review-btn--muted"
              disabled={busy}
              onClick={() => void handleReviewAction('already-solved')}
              title="Remove this problem from independent reviews"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </article>
  );
}

export function PracticeRecommendations({
  recommendations,
  handle,
  expandedByDefault = false,
  onFeedbackRecorded,
}: {
  recommendations: RecommendedProblem[];
  handle?: string;
  expandedByDefault?: boolean;
  onFeedbackRecorded?: () => void;
}) {
  const [showAll, setShowAll] = useState(expandedByDefault);
  const [resolvedKeys, setResolvedKeys] = useState<Set<string>>(() => new Set());
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setResolvedKeys(new Set());
  }, [recommendations]);

  const visibleRecommendations = recommendations.filter(
    p => !resolvedKeys.has(`${p.contestId}-${p.index}`)
  );
  const shown = showAll ? visibleRecommendations : visibleRecommendations.slice(0, 1);

  useEffect(() => {
    if (!handle || !sectionRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        const date = new Date();
        const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        void recordPracticeImpressions(
          handle,
          shown.map(problem => `${problem.contestId}-${problem.index}`),
          day
        ).catch(() => {});
        observer.disconnect();
      },
      { threshold: 0.1 }
    );
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, [handle, visibleRecommendations, showAll]);

  const handleResolved = (key: string) => {
    setResolvedKeys(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    onFeedbackRecorded?.();
  };

  return (
    <section ref={sectionRef} className="practice-session" aria-label="Practice session">
      {visibleRecommendations.length ? (
        <>
          <div className="practice-session-heading">
            <h2>Next problem</h2>
            <span>{visibleRecommendations.length} available</span>
          </div>
          {shown.map(problem => (
            <PracticeCard
              key={`${problem.contestId}-${problem.index}`}
              problem={problem}
              handle={handle}
              onResolved={handleResolved}
            />
          ))}
          {visibleRecommendations.length > 1 && (
            <button
              type="button"
              className="practice-more-button"
              onClick={() => setShowAll(value => !value)}
              aria-expanded={showAll}
            >
              {showAll ? 'Show one problem' : `See ${visibleRecommendations.length - 1} more choices`}
            </button>
          )}
        </>
      ) : (
        <p className="cf-empty">No tasks remain within today's goal and suitable difficulty range.</p>
      )}
    </section>
  );
}
