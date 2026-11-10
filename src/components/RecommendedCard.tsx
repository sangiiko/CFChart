import React from 'react';
import { RecommendedProblem } from '../types/codeforces';
import { Target, ExternalLink, Dumbbell, Zap } from 'lucide-react';

interface RecommendedCardProps {
  problems: RecommendedProblem[];
}

export const RecommendedCard: React.FC<RecommendedCardProps> = ({ problems }) => {
  if (!problems || problems.length === 0) return null;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm text-sm">
      <div className="flex items-center justify-between mb-3 border-b border-slate-800/80 pb-2">
        <div className="flex items-center gap-2 font-medium text-slate-200">
          <Dumbbell className="w-4 h-4 text-emerald-400" />
          <span>Today's Recommended 2 Problems</span>
        </div>
        <span className="text-[11px] text-slate-400">Target rating zone</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {problems.map((prob) => {
          const isWarmup = prob.type === 'warmup';

          return (
            <a
              key={`${prob.contestId}-${prob.index}`}
              href={prob.url}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col justify-between p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800/90 border border-slate-700/60 hover:border-slate-600 transition-all group"
            >
              <div className="mb-2">
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <span
                    className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${
                      isWarmup
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {isWarmup ? <Zap className="w-2.5 h-2.5" /> : <Target className="w-2.5 h-2.5" />}
                    {isWarmup ? 'Problem 1: Consolidation' : 'Problem 2: Growth Challenge'}
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-200 px-1.5 py-0.5 bg-slate-700/60 rounded">
                    ★ {prob.rating}
                  </span>
                </div>

                <div className="font-medium text-slate-100 group-hover:text-sky-300 transition-colors line-clamp-1">
                  {prob.contestId}{prob.index}. {prob.name}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px]">
                <div className="flex flex-wrap gap-1 text-slate-400">
                  {prob.tags.slice(0, 2).map((t) => (
                    <span key={t} className="text-[10px] px-1 py-0.2 bg-slate-900/60 rounded text-slate-400">
                      #{t}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1 text-sky-400 font-medium group-hover:translate-x-0.5 transition-transform">
                  <span>Solve</span>
                  <ExternalLink className="w-3 h-3" />
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
};
