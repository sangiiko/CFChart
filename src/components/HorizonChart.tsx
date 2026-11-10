import React from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
} from 'recharts';
import { ChartDataPoint } from '../types/codeforces';
import { getRankTier } from '../services/codeforcesApi';

interface HorizonChartProps {
  data: ChartDataPoint[];
  currentRating: number;
  height?: number;
}

const CustomDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!cx || !cy) return null;

  if (payload.isPrediction) {
    // Elegant subtle grey dot for prediction sample points
    return (
      <circle
        cx={cx}
        cy={cy}
        r={3}
        fill="#64748b"
        stroke="#94a3b8"
        strokeWidth={1.5}
        fillOpacity={0.8}
      />
    );
  }

  // Colorful dot for historical contests based on tier
  const color = payload.rankColor || getRankTier(payload.historicalRating).color;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={color}
      stroke="#ffffff"
      strokeWidth={1.5}
    />
  );
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload || !payload.length) return null;

  const data: ChartDataPoint = payload[0].payload;
  const isPred = data.isPrediction;
  const rating = isPred ? data.predictedRating : data.historicalRating;
  const tier = getRankTier(rating);

  return (
    <div className="bg-slate-900/95 border border-slate-700/80 rounded-lg p-3 shadow-xl backdrop-blur-sm text-xs min-w-[190px]">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5 mb-2">
        <span className="text-slate-400 font-mono">{data.dateStr}</span>
        {isPred ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-medium">
            Projected
          </span>
        ) : (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: `${tier.color}20`, color: tier.color }}>
            Contest
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-slate-300 font-semibold">Rating:</span>
        <span className="text-sm font-bold font-mono" style={{ color: isPred ? '#94a3b8' : tier.color }}>
          {rating}
        </span>
        <span className="text-[11px] text-slate-400">({tier.name})</span>
      </div>

      {isPred ? (
        <div className="text-[11px] text-slate-400 space-y-0.5 pt-1 border-t border-slate-800/80">
          <div>Range: {data.lowerBound} – {data.upperBound}</div>
          <div className="text-slate-500 italic">2 problems/day pace</div>
        </div>
      ) : (
        <div className="text-[11px] text-slate-300 space-y-0.5 pt-1 border-t border-slate-800/80">
          <div className="font-medium text-slate-200 line-clamp-1">{data.contestName || 'Contest'}</div>
          {data.rank && <div className="text-slate-400">Rank: #{data.rank}</div>}
        </div>
      )}
    </div>
  );
};

export const HorizonChart: React.FC<HorizonChartProps> = ({
  data,
  currentRating,
  height = 360,
}) => {
  // Compute Y-axis bounds
  const allRatings = data
    .flatMap(d => [d.historicalRating, d.predictedRating, d.lowerBound, d.upperBound])
    .filter((r): r is number => typeof r === 'number');

  const minRating = Math.max(600, Math.floor((Math.min(...allRatings, currentRating) - 100) / 100) * 100);
  const maxRating = Math.min(3200, Math.ceil((Math.max(...allRatings, currentRating) + 150) / 100) * 100);

  return (
    <div className="w-full relative select-none">
      <div className="h-[360px] w-full" style={{ height: `${height}px` }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 15, right: 25, bottom: 20, left: 0 }}>
            {/* Codeforces official tier background bands */}
            <ReferenceArea y1={0} y2={1200} fill="#cccccc" fillOpacity={0.16} />
            <ReferenceArea y1={1200} y2={1400} fill="#77ff77" fillOpacity={0.14} />
            <ReferenceArea y1={1400} y2={1600} fill="#77ddbb" fillOpacity={0.14} />
            <ReferenceArea y1={1600} y2={1900} fill="#aaaaef" fillOpacity={0.14} />
            <ReferenceArea y1={1900} y2={2200} fill="#ff88ff" fillOpacity={0.14} />
            <ReferenceArea y1={2200} y2={2400} fill="#ffcc88" fillOpacity={0.14} />
            <ReferenceArea y1={2400} y2={4000} fill="#ff7777" fillOpacity={0.14} />

            {/* Current rating reference horizontal line */}
            <ReferenceLine
              y={currentRating}
              stroke="#94a3b8"
              strokeDasharray="2 2"
              strokeOpacity={0.6}
            />

            <XAxis
              dataKey="dateStr"
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              minTickGap={45}
            />
            <YAxis
              domain={[minRating, maxRating]}
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              width={42}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Grey Confidence envelope for future prediction */}
            <Area
              type="monotone"
              dataKey="upperBound"
              stroke="transparent"
              fill="#64748b"
              fillOpacity={0.12}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="lowerBound"
              stroke="transparent"
              fill="#0f172a"
              fillOpacity={0.9}
              isAnimationActive={false}
            />

            {/* Solid Historical Contest Line (Rank tier colored points) */}
            <Line
              type="monotone"
              dataKey="historicalRating"
              stroke="#38bdf8"
              strokeWidth={2.5}
              dot={<CustomDot />}
              activeDot={{ r: 6, fill: '#38bdf8', stroke: '#ffffff', strokeWidth: 2 }}
              connectNulls
              isAnimationActive={true}
            />

            {/* Dashed Slate-Grey Future Prediction Line */}
            <Line
              type="monotone"
              dataKey="predictedRating"
              stroke="#94a3b8"
              strokeWidth={2.2}
              strokeDasharray="5 4"
              dot={<CustomDot />}
              activeDot={{ r: 5, fill: '#94a3b8', stroke: '#ffffff', strokeWidth: 2 }}
              connectNulls
              isAnimationActive={true}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend & Tier markers */}
      <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 mt-2 px-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-1 bg-sky-400 rounded-full inline-block"></span>
            <span className="text-slate-300 font-medium">Earned Rating</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 border-t-2 border-dashed border-slate-400 inline-block"></span>
            <span className="text-slate-400">Future Horizon (Grey)</span>
          </div>
        </div>
        <div className="text-[10px] text-slate-400 font-mono">
          Current: <strong className="text-slate-200">{currentRating}</strong>
        </div>
      </div>
    </div>
  );
};
