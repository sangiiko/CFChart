import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build as bundle } from 'esbuild';
import { build as buildPages } from 'vite';

// Sources stay sources. Vite cleans dist/ and copies the one public manifest.
execFileSync(resolve('node_modules/.bin/tsc'), ['--noEmit'], { stdio: 'inherit' });
await buildPages();
const common = {
  bundle: true, minify: true, sourcemap: false,
  target: ['firefox109'], format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none',
};
await bundle({ ...common, entryPoints: ['src/content/index.tsx'], outfile: 'dist/content.js', loader: { '.css': 'text' } });
await bundle({ ...common, entryPoints: ['src/background/index.ts'], outfile: 'dist/background.js' });

const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
const referenced = [
  ...Object.values(manifest.icons), manifest.action.default_popup,
  ...Object.values(manifest.action.default_icon), ...manifest.background.scripts,
  ...manifest.content_scripts.flatMap(entry => [...entry.js, ...(entry.css ?? [])]),
];
for (const file of referenced) {
  if (!existsSync(resolve('dist', file))) throw new Error(`Missing packaged resource: ${file}`);
}
for (const page of readdirSync('dist').filter(file => file.endsWith('.html'))) {
  const html = readFileSync(resolve('dist', page), 'utf8');
  if (/\/src\//.test(html)) throw new Error(`Unbuilt source reference in ${page}`);
  for (const [, asset] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (!/^(?:https?:|data:)/.test(asset) && !existsSync(resolve('dist', asset.replace(/^\//, '')))) {
      throw new Error(`Missing HTML resource in ${page}: ${asset}`);
    }
  }
}

// Build Chrome-compatible package in dist-chrome/
rmSync('dist-chrome', { recursive: true, force: true });
cpSync('dist', 'dist-chrome', { recursive: true });
const chromeManifest = { ...manifest };
delete chromeManifest.browser_specific_settings;
chromeManifest.background = { service_worker: 'background.js' };
writeFileSync('dist-chrome/manifest.json', JSON.stringify(chromeManifest, null, 2));

console.log('\nCFChart is ready.\n- For Firefox: Load dist/manifest.json in about:debugging\n- For Chrome / Brave / Edge: Load dist-chrome/ as Unpacked Extension in chrome://extensions');
