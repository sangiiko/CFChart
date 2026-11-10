import React from 'react';
import { PredictionParams } from '../types/codeforces';
interface Props { params: PredictionParams; onChange: (params: PredictionParams) => void; projectedRating: number; currentRating: number; totalProblems: number }
export const PracticeSimulator: React.FC<Props> = ({ params, onChange, projectedRating, totalProblems }) => <div className="cf-simulator">
  <p className="cf-muted">Illustrative scenario only. This diminishing-returns curve uses fixed assumptions; it is separate from the trained model and does not estimate your actual improvement.</p>
  <div className="cf-controls">
    <label>Problems per day <strong>{params.dailyProblems}</strong><input aria-label="Scenario problems per day" type="range" min="1" max="5" step="1" value={params.dailyProblems} onChange={e => onChange({ ...params, dailyProblems: Number(e.target.value) })} /></label>
    <label>Difficulty above rating <strong>+{params.difficultyOffset}</strong><input aria-label="Scenario difficulty above rating" type="range" min="0" max="300" step="25" value={params.difficultyOffset} onChange={e => onChange({ ...params, difficultyOffset: Number(e.target.value) })} /></label>
    <label>Scenario duration<select value={params.horizonMonths} onChange={e => onChange({ ...params, horizonMonths: Number(e.target.value) })}><option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option></select></label>
  </div>
  <div className="cf-scenario-result">Scenario endpoint <strong>{projectedRating}</strong><span>after approximately {totalProblems} problems</span></div>
</div>;
