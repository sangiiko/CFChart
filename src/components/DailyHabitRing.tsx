import React from 'react';
import { HabitProgress } from '../types/codeforces';
import { Flame, CheckCircle, ExternalLink } from 'lucide-react';

interface DailyHabitRingProps {
  progress: HabitProgress;
  onRefresh?: () => void;
  compact?: boolean;
}

export const DailyHabitRing: React.FC<DailyHabitRingProps> = ({ progress, compact = false }) => {
  const { todayCount, dailyTarget, isTodayTargetMet, todayProblems, currentStreak, recentDays } = progress;
  const percentage = Math.min(100, Math.round((todayCount / dailyTarget) * 100));

  // SVG ring properties
  const radius = compact ? 28 : 38;
  const stroke = compact ? 5 : 7;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className={`bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm ${compact ? 'text-xs' : 'text-sm'}`}>
      <div className="flex items-center justify-between mb-3 border-b border-slate-800/80 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
          <span className="font-semibold text-slate-100">Daily 2-Problem Habit</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold">
          <Flame className="w-3.5 h-3.5 fill-amber-400" />
          <span>{currentStreak} Day{currentStreak === 1 ? '' : 's'} Streak</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Radial Progress Circle */}
        <div className="relative shrink-0 flex items-center justify-center">
          <svg height={radius * 2} width={radius * 2} className="rotate-[-90deg]">
            <circle
              stroke="#1e293b"
              fill="transparent"
              strokeWidth={stroke}
              r={normalizedRadius}
              cx={radius}
              cy={radius}
            />
            <circle
              stroke={isTodayTargetMet ? '#10b981' : percentage > 0 ? '#38bdf8' : '#64748b'}
              fill="transparent"
              strokeWidth={stroke}
              strokeDasharray={`${circumference} ${circumference}`}
              style={{ strokeDashoffset, transition: 'stroke-dashoffset 0.6s ease' }}
              strokeLinecap="round"
              r={normalizedRadius}
              cx={radius}
              cy={radius}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center font-mono">
            <span className="font-bold text-slate-100 text-sm">{todayCount}/{dailyTarget}</span>
            <span className="text-[9px] text-slate-400">today</span>
          </div>
        </div>

        {/* Status text */}
        <div className="flex-1 min-w-0">
          {isTodayTargetMet ? (
            <div className="flex items-center gap-1.5 text-emerald-400 font-medium text-xs mb-1">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>Target achieved today!</span>
            </div>
          ) : (
            <div className="text-slate-300 font-medium text-xs mb-1">
              {todayCount === 0 ? 'Ready for today? Solve 2 problems!' : '1 down, 1 to go! Finish strong!'}
            </div>
          )}
          <p className="text-[11px] text-slate-400">
            {todayCount >= dailyTarget
              ? `Great consistency! Streak maintained at ${currentStreak} days.`
              : `Solve ${dailyTarget - todayCount} more accepted problem${dailyTarget - todayCount > 1 ? 's' : ''} to maintain streak.`}
          </p>
        </div>
      </div>

      {/* Solved Problems Today List */}
      {todayProblems.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-slate-800/80">
          <span className="text-[11px] font-medium text-slate-400 block mb-1.5">Solved Today:</span>
          <div className="space-y-1">
            {todayProblems.map((prob) => (
              <a
                key={prob.key}
                href={prob.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between py-1 px-2 rounded bg-slate-800/60 hover:bg-slate-800 text-xs text-slate-200 transition-colors group"
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  <span className="font-mono text-slate-400 font-medium text-[11px]">{prob.key}</span>
                  <span className="truncate">{prob.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {prob.rating && (
                    <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 bg-slate-700/80 rounded text-slate-300">
                      {prob.rating}
                    </span>
                  )}
                  <ExternalLink className="w-3 h-3 text-slate-500 group-hover:text-slate-300" />
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 30-Day Activity Heatmap Grid */}
      {!compact && recentDays && recentDays.length > 0 && (
        <div className="mt-3.5 pt-2.5 border-t border-slate-800/80">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
            <span>Last 30 Days Consistency:</span>
            <span className="text-[10px] text-slate-500">Target: 2/day</span>
          </div>
          <div className="flex items-center gap-1 justify-between">
            {recentDays.map((day) => (
              <div
                key={day.dateStr}
                title={`${day.dateStr}: ${day.solvedCount} problems solved`}
                className={`w-2.5 h-3.5 rounded-sm transition-all ${
                  day.targetMet
                    ? 'bg-emerald-500'
                    : day.solvedCount > 0
                    ? 'bg-sky-500/70'
                    : 'bg-slate-800'
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
