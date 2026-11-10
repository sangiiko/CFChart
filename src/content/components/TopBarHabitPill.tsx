import React, { useState } from 'react';
import { HabitProgress, RecommendedProblem } from '../../types/codeforces';
import { Flame, CheckCircle, Target, ExternalLink, ChevronDown, Sparkles } from 'lucide-react';

interface TopBarHabitPillProps {
  progress: HabitProgress;
  recommended: RecommendedProblem[];
  handle: string;
  onOpenProfileHorizon: () => void;
}

export const TopBarHabitPill: React.FC<TopBarHabitPillProps> = ({
  progress,
  recommended,
  handle,
  onOpenProfileHorizon,
}) => {
  const [open, setOpen] = useState(false);
  const { todayCount, dailyTarget, isTodayTargetMet, currentStreak, todayProblems } = progress;

  return (
    <div className="relative inline-block text-xs font-sans select-none z-50">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-1 rounded-full border transition-all shadow-sm ${
          isTodayTargetMet
            ? 'bg-emerald-950/80 border-emerald-600/70 text-emerald-300 hover:bg-emerald-900/90'
            : todayCount > 0
            ? 'bg-sky-950/80 border-sky-600/70 text-sky-300 hover:bg-sky-900/90'
            : 'bg-slate-900/90 border-slate-700 text-slate-300 hover:bg-slate-800'
        }`}
      >
        <div className="flex items-center gap-1 font-semibold">
          <Flame className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
          <span>{currentStreak}d</span>
        </div>
        <span className="text-slate-500">|</span>
        <div className="flex items-center gap-1 font-mono font-bold">
          <span>Today: {todayCount}/{dailyTarget}</span>
          {isTodayTargetMet && <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />}
        </div>
        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Flyout Menu */}
      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-2xl text-slate-200 animate-fadeIn">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs font-semibold">
            <span className="flex items-center gap-1 text-slate-200">
              <Target className="w-3.5 h-3.5 text-sky-400" />
              CFChart Daily Goal
            </span>
            <span className="font-mono text-slate-400">@{handle}</span>
          </div>

          <div className="py-2.5">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-400">Status</span>
              <span className={`font-semibold ${isTodayTargetMet ? 'text-emerald-400' : 'text-sky-400'}`}>
                {isTodayTargetMet ? 'Goal Completed! 🎉' : `${dailyTarget - todayCount} problem(s) remaining`}
              </span>
            </div>
            
            <div className="w-full bg-slate-800 rounded-full h-2 mb-2 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${isTodayTargetMet ? 'bg-emerald-500' : 'bg-sky-500'}`}
                style={{ width: `${Math.min(100, (todayCount / dailyTarget) * 100)}%` }}
              />
            </div>

            {/* Solved today list */}
            {todayProblems.length > 0 && (
              <div className="mt-2 space-y-1">
                <span className="text-[10px] text-slate-400 font-medium">Solved Today:</span>
                {todayProblems.map((p) => (
                  <div key={p.key} className="flex items-center justify-between text-[11px] bg-slate-800/60 px-2 py-0.5 rounded text-slate-300">
                    <span className="truncate max-w-[170px]">{p.key}: {p.name}</span>
                    <span className="text-emerald-400 font-mono text-[10px]">OK</span>
                  </div>
                ))}
              </div>
            )}

            {/* Workout recommendations */}
            {!isTodayTargetMet && recommended.length > 0 && (
              <div className="mt-2.5 pt-2 border-t border-slate-800">
                <span className="text-[10px] text-slate-400 font-medium block mb-1">Recommended next:</span>
                <div className="space-y-1">
                  {recommended.map((p) => (
                    <a
                      key={p.url}
                      href={p.url}
                      className="flex items-center justify-between bg-slate-800/80 hover:bg-slate-700/80 px-2 py-1 rounded text-xs text-sky-300 transition-colors group"
                    >
                      <span className="truncate text-[11px] font-medium">{p.contestId}{p.index}. {p.name}</span>
                      <ExternalLink className="w-3 h-3 shrink-0 text-slate-400 group-hover:text-sky-300" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-[11px]">
            <button
              onClick={() => {
                setOpen(false);
                onOpenProfileHorizon();
              }}
              className="text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3" />
              <span>View Rating Horizon</span>
            </button>
            <span className="text-slate-500 font-mono">{currentStreak}d streak</span>
          </div>
        </div>
      )}
    </div>
  );
};
