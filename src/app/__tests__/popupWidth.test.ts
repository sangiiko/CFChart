import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

// Popup width comes from its content, so viewport units there collapse the panel.
test('popup root width is fixed, never viewport-relative', () => {
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');
  const rule = css.match(/\.practice-app\{([^}]*)\}/)?.[1] ?? '';
  expect(rule).toContain('width:380px');
  expect(rule).not.toMatch(/\d(vw|vh)/);
});
