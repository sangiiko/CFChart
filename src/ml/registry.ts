// Installed by python -m ml.install after evaluation and runtime parity checks.
import model from './model.json';
import type { ForecastModel } from './inference';
export const bundledForecastModel = model as unknown as ForecastModel;
