import React from 'react';
import { PredictionParams } from '../types/codeforces';
import { Sliders, Sparkles, TrendingUp, Calendar } from 'lucide-react';

interface PracticeSimulatorProps {
  params: PredictionParams;
  onChange: (params: PredictionParams) => void;
  projectedRating: number;
  currentRating: number;
  totalProblems: number;
}

export const PracticeSimulator: React.FC<PracticeSimulatorProps> = ({
  params,
  onChange,
  projectedRating,
  currentRating,
  totalProblems,
}) => {
  const ratingDelta = projectedRating - currentRating;

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-sm text-sm">
      <div className="flex items-center justify-between mb-3 border-b border-slate-800/80 pb-2">
        <div className="flex items-center gap-2 font-medium text-slate-200">
          <Sliders className="w-4 h-4 text-sky-400" />
          <span>Practice Horizon Simulator</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-sky-300 font-mono bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/50">
          <TrendingUp className="w-3.5 h-3.5" />
          <span>+{ratingDelta > 0 ? ratingDelta : 0} Projected</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Slider 1: Daily Target */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-400">Daily Target</span>
            <span className="font-semibold text-sky-400 font-mono">
              {params.dailyProblems} {params.dailyProblems === 1 ? 'problem' : 'problems'} / day
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={params.dailyProblems}
            onChange={(e) => onChange({ ...params, dailyProblems: Number(e.target.value) })}
            className="w-full accent-sky-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500 font-mono">
            <span>1/day</span>
            <span className="text-sky-400 font-bold">2/day (Target)</span>
            <span>5/day</span>
          </div>
        </div>

        {/* Slider 2: Difficulty Offset */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-400">Practice Difficulty</span>
            <span className="font-semibold text-emerald-400 font-mono">
              +{params.difficultyOffset} above rating
            </span>
          </div>
          <input
            type="range"
            min={50}
            max={300}
            step={25}
            value={params.difficultyOffset}
            onChange={(e) => onChange({ ...params, difficultyOffset: Number(e.target.value) })}
            className="w-full accent-emerald-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500 font-mono">
            <span>+50 (Warmup)</span>
            <span>+150 (Sweet Spot)</span>
            <span>+300 (Stretch)</span>
          </div>
        </div>

        {/* Horizon timeframe buttons */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-400">Time Horizon</span>
            <span className="font-semibold text-purple-400 font-mono flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {params.horizonMonths} Months
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 pt-0.5">
            {[3, 6, 12].map((m) => (
              <button
                key={m}
                onClick={() => onChange({ ...params, horizonMonths: m })}
                className={`text-xs py-1 px-2 rounded font-medium transition-all ${
                  params.horizonMonths === m
                    ? 'bg-purple-600/80 text-white shadow'
                    : 'bg-slate-800/80 text-slate-400 hover:bg-slate-700/80 hover:text-slate-200'
                }`}
              >
                {m}m
              </button>
            ))}
          </div>
          <div className="text-[10px] text-slate-500 text-right font-mono">
            ~{totalProblems} total problems
          </div>
        </div>
      </div>

      {/* Motivational outcome summary */}
      <div className="mt-3.5 pt-2.5 border-t border-slate-800/70 flex items-center gap-2 text-xs text-slate-400 bg-slate-950/40 px-3 py-1.5 rounded-lg">
        <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span>
          Solving <strong className="text-slate-200">{params.dailyProblems} problems/day</strong> at{' '}
          <strong className="text-slate-200">+{params.difficultyOffset}</strong> projects your rating from{' '}
          <strong className="text-slate-200">{currentRating}</strong> to{' '}
          <strong className="text-sky-300 font-mono">{projectedRating}</strong> in {params.horizonMonths} months.
        </span>
      </div>
    </div>
  );
};
