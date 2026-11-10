import React, { useState } from 'react';
import { CFRatingChange, PredictionParams, HabitProgress } from '../../types/codeforces';
import { generateHorizonProjection } from '../../services/predictorModel';
import { HorizonChart } from '../../components/HorizonChart';
import { PracticeSimulator } from '../../components/PracticeSimulator';
import { MilestoneGrid } from '../../components/MilestoneGrid';
import { Sparkles, BarChart2, Loader2 } from 'lucide-react';

interface ProfileHorizonCardProps {
  handle: string;
  currentRating: number;
  ratingHistory: CFRatingChange[];
  habitProgress?: HabitProgress;
  isLoading?: boolean;
}

export const ProfileHorizonCard: React.FC<ProfileHorizonCardProps> = ({
  handle,
  currentRating,
  ratingHistory,
  isLoading = false,
}) => {
  const [activeTab, setActiveTab] = useState<'horizon' | 'original'>('horizon');
  const [params, setParams] = useState<PredictionParams>({
    dailyProblems: 2,
    difficultyOffset: 150,
    horizonMonths: 6,
  });

  const horizon = generateHorizonProjection(ratingHistory, currentRating, params);

  return (
    <div className="cfchart-profile-root my-5 bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-2xl text-slate-100 font-sans transition-all">
      {/* Header with requested Toggle Switch: [CFChart Horizon] | [Original Chart] */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base text-slate-100 tracking-tight">CFChart Rating Horizon</h3>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-sky-300 font-semibold border border-slate-700">
                @{handle}
              </span>
              {isLoading && (
                <span className="text-[10px] text-amber-400 font-mono animate-pulse">Syncing...</span>
              )}
            </div>
            <p className="text-xs text-slate-400">
              Colored past contests &bull; <strong className="text-slate-300 font-medium">Slate-grey future horizon</strong>
            </p>
          </div>
        </div>

        {/* The Toggle Switch requested by user */}
        <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => {
              setActiveTab('horizon');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
              activeTab === 'horizon'
                ? 'bg-sky-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>CFChart Horizon</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('original');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all ${
              activeTab === 'original'
                ? 'bg-slate-700 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Original Codeforces Graph</span>
          </button>
        </div>
      </div>

      {activeTab === 'horizon' ? (
        <div className="space-y-4">
          {/* Main Codeforces-styled Chart with colored past & grey future */}
          <div className="bg-slate-900/70 rounded-xl p-3 border border-slate-800/80">
            <HorizonChart
              data={horizon.chartData}
              currentRating={horizon.currentRating}
              height={380}
            />
          </div>

          {/* Milestone Target Badges */}
          <MilestoneGrid
            milestones={horizon.milestones}
            currentRating={horizon.currentRating}
          />

          {/* Interactive Practice Simulator */}
          <PracticeSimulator
            params={params}
            onChange={setParams}
            projectedRating={horizon.projectedRatingAtHorizon}
            currentRating={horizon.currentRating}
            totalProblems={horizon.totalProjectedProblems}
          />
        </div>
      ) : (
        <div className="p-6 text-center text-xs text-slate-400 bg-slate-900/40 rounded-xl border border-slate-800">
          Viewing standard Codeforces graph below. Switch back to <strong>CFChart Horizon</strong> anytime!
        </div>
      )}
    </div>
  );
};
