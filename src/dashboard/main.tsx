import React from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardApp } from './DashboardApp';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <DashboardApp />
    </React.StrictMode>
  );
}
