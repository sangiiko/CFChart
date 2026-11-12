import React from 'react';
import { ChartDataPoint } from '../types/codeforces';
import { getRankTier } from '../services/codeforcesApi';

export interface ForecastPoint { timestamp: number; lower: number; median: number; upper: number; horizonDays: number }
interface HorizonChartProps {
  data: ChartDataPoint[];
  currentRating?: number | null;
  height?: number;
  forecasts?: ForecastPoint[];
}
const bands = [
  { from: 0, to: 1200, color: '#ccc' }, { from: 1200, to: 1400, color: '#77ff77' },
  { from: 1400, to: 1600, color: '#77ddbb' }, { from: 1600, to: 1900, color: '#aaaaff' },
  { from: 1900, to: 2200, color: '#ff88ff' }, { from: 2200, to: 2400, color: '#ffcc88' },
  { from: 2400, to: 2600, color: '#ffbb55' }, { from: 2600, to: 3000, color: '#ff7777' },
  { from: 3000, to: 10000, color: '#ff3333' },
];
const date = (timestamp: number) => new Date(timestamp).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
const preciseDate = (timestamp: number) => new Date(timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** Uses a numeric time axis; every accepted official rating change is retained. */
export const HorizonChart: React.FC<HorizonChartProps> = ({ data, currentRating, height = 300, forecasts = [] }) => {
  const history = data.filter(p => !p.isPrediction && Number.isFinite(p.historicalRating)).sort((a, b) => a.timestamp - b.timestamp);
  const scenario = data.filter(p => p.isPrediction && Number.isFinite(p.predictedRating)).sort((a, b) => a.timestamp - b.timestamp);
  const values = [...history.map(p => p.historicalRating!), ...scenario.map(p => p.predictedRating!), ...forecasts.flatMap(p => [p.lower, p.upper])];
  if (currentRating != null && Number.isFinite(currentRating)) values.push(currentRating);
  if (!history.length && !scenario.length && !forecasts.length) return <div className="cf-empty">No rated contests yet. Your official history will appear after your first rated contest.</div>;
  const timestamps = [...history, ...scenario].map(p => p.timestamp).concat(forecasts.map(p => p.timestamp));
  const minTime = Math.min(...timestamps), maxTime = Math.max(...timestamps);
  const span = Math.max(86_400_000, maxTime - minTime);
  const xMin = minTime - span * 0.02, xMax = maxTime + span * 0.02;
  const yMin = Math.floor((Math.min(...values) - 100) / 100) * 100;
  const yMax = Math.ceil((Math.max(...values) + 100) / 100) * 100;
  const width = 880, left = 52, right = width - 18, top = 18, bottom = height - 38;
  const x = (t: number) => left + (t - xMin) / (xMax - xMin) * (right - left);
  const y = (r: number) => bottom - (r - yMin) / (yMax - yMin) * (bottom - top);
  const path = (points: ChartDataPoint[], key: 'historicalRating' | 'predictedRating') => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.timestamp).toFixed(2)},${y(p[key]!).toFixed(2)}`).join(' ');
  const scenarioEnd = scenario[scenario.length - 1];
  const ticks = Array.from({ length: 5 }, (_, i) => yMin + (yMax - yMin) * i / 4);
  return <div className="cf-chart">
    <div className="cf-chart-plot">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Official Codeforces rating history, ${history.length} contests${scenario.length ? ', with an illustrative practice scenario' : ''}${forecasts.length ? ', with model forecast intervals' : ''}`}>
      <title>Official Codeforces rating over time</title>
      {bands.filter(b => b.to > yMin && b.from < yMax).map(b => <rect key={b.from} x={left} y={y(Math.min(yMax, b.to))} width={right - left} height={y(Math.max(yMin, b.from)) - y(Math.min(yMax, b.to))} fill={b.color} opacity="0.16" />)}
      {ticks.map(tick => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke="#dce5ed" strokeWidth="1" /><text x={left - 8} y={y(tick) + 4} textAnchor="end" className="cf-axis">{Math.round(tick)}</text></g>)}
      {Array.from({ length: 5 }, (_, i) => { const time = minTime + (maxTime - minTime) * i / 4; return <text key={i} x={x(time)} y={bottom + 24} textAnchor="middle" className="cf-axis">{date(time)}</text>; })}
      {currentRating != null && <line x1={left} x2={right} y1={y(currentRating)} y2={y(currentRating)} stroke="#64748b" strokeDasharray="3 5" opacity="0.5" />}
      {history.length > 1 && <path d={path(history, 'historicalRating')} stroke="#2563a6" strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke" />}
      {history.map((p, i) => <circle key={`${p.timestamp}-${i}`} cx={x(p.timestamp)} cy={y(p.historicalRating!)} r="3.5" fill={p.rankColor || '#2563a6'} stroke="#fff" strokeWidth="1"><title>{`${preciseDate(p.timestamp)} · ${p.contestName} · Rating ${p.historicalRating}${p.rank ? ` · Rank ${p.rank}` : ''}`}</title></circle>)}
      {scenario.length > 1 && <path d={path(scenario, 'predictedRating')} stroke="#64748b" strokeWidth="2" strokeDasharray="6 5" fill="none" vectorEffect="non-scaling-stroke" />}
      {scenario.length > 0 && <circle cx={x(scenarioEnd!.timestamp)} cy={y(scenarioEnd!.predictedRating!)} r="4" fill="#64748b"><title>{`Illustrative scenario · ${preciseDate(scenarioEnd!.timestamp)} · ${scenarioEnd!.predictedRating}`}</title></circle>}
      {history.length > 0 && forecasts.length > 0 && (
        <path
          d={`M${x(history[history.length - 1].timestamp).toFixed(2)},${y(history[history.length - 1].historicalRating!).toFixed(2)} ${[...forecasts]
            .sort((a, b) => a.horizonDays - b.horizonDays)
            .map(f => `L${x(f.timestamp).toFixed(2)},${y(f.median).toFixed(2)}`)
            .join(' ')}`}
          stroke="#64748b"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {forecasts.map(p => {
        const tier = getRankTier(p.median);
        const tierColor = tier.color || '#2563a6';
        return (
          <g key={p.horizonDays}>
            <line
              x1={x(p.timestamp)}
              x2={x(p.timestamp)}
              y1={y(p.lower)}
              y2={y(p.upper)}
              stroke={tierColor}
              strokeWidth="6"
              strokeLinecap="round"
              opacity="0.35"
            />
            <circle
              cx={x(p.timestamp)}
              cy={y(p.median)}
              r="4.5"
              fill={tierColor}
              stroke="#fff"
              strokeWidth="1.5"
            >
              <title>{`${p.horizonDays}-day forecast · ${p.median} (${tier.name}) · Range: ${p.lower}–${p.upper} (±${Math.round((p.upper - p.lower) / 2)} pts)`}</title>
            </circle>
          </g>
        );
      })}
    </svg>
    </div>
    <div className="cf-chart-legend"><span><i className="cf-history-key" />Official rating</span>{scenario.length > 0 && <span><i className="cf-scenario-key" />Illustrative scenario</span>}{forecasts.length > 0 && <span><i className="cf-forecast-key" />Model estimate</span>}<span className="cf-chart-hint">Exact values in contest history</span></div>
    <details className="cf-history-table"><summary>Contest history ({history.length})</summary><div className="cf-table-scroll"><table><thead><tr><th>Date</th><th>Contest</th><th>Rank</th><th>Rating</th></tr></thead><tbody>{[...history].reverse().map((p, i) => <tr key={`${p.timestamp}-${i}`}><td>{preciseDate(p.timestamp)}</td><td>{p.contestName}</td><td>{p.rank ?? '—'}</td><td style={{ color: p.rankColor }}>{p.historicalRating}</td></tr>)}</tbody></table></div></details>
  </div>;
};
