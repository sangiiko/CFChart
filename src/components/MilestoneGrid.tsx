import React from 'react';
import { MilestoneTarget } from '../types/codeforces';
import { CheckCircle2, Clock, Target } from 'lucide-react';
import { format } from 'date-fns';

interface MilestoneGridProps {
  milestones: MilestoneTarget[];
  currentRating: number;
}

export const MilestoneGrid: React.FC<MilestoneGridProps> = ({ milestones, currentRating }) => {
  // Show up to 4 relevant milestones (the next few unachieved, or latest achieved)
  const relevantMilestones = milestones.filter(m => m.threshold >= Math.min(1200, currentRating - 200)).slice(0, 4);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {relevantMilestones.map((m) => {
        const isAchieved = m.achieved;

        return (
          <div
            key={m.rankName}
            className={`rounded-xl p-3 border transition-all text-xs flex flex-col justify-between ${
              isAchieved
                ? 'bg-slate-900/50 border-emerald-900/40 text-slate-400'
                : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-slate-700 shadow-sm'
            }`}
          >
            <div>
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span
                  className="font-bold text-[11px] px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: `${m.color}25`, color: m.color }}
                >
                  {m.rankName}
                </span>
                <span className="font-mono text-slate-400 font-semibold">{m.threshold}</span>
              </div>

              {isAchieved ? (
                <div className="flex items-center gap-1.5 text-emerald-400 font-medium mt-2">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Achieved!</span>
                </div>
              ) : m.estimatedDate ? (
                <div className="space-y-1 mt-1.5">
                  <div className="flex items-center gap-1 text-slate-300 font-medium">
                    <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>{format(m.estimatedDate, 'MMM d, yyyy')}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800/80">
                    <span>~{m.daysRemaining} days</span>
                    <span className="font-mono text-sky-400">~{m.problemsRemaining} probs</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-slate-500 mt-2">
                  <Target className="w-3.5 h-3.5" />
                  <span>Target horizon</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
