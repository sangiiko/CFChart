import { startCFChart } from './controller';
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startCFChart, { once: true });
else startCFChart();
