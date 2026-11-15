import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build as bundle } from 'esbuild';
import { build as buildPages } from 'vite';

// Node-only zip so the build never depends on a system `zip` binary.
import { deflateRawSync } from 'node:zlib';
function writeZip(outFile, rootDir) {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  })(rootDir);
  files.sort();
  const locals = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.slice(rootDir.length + 1).split('\\').join('/'));
    const data = readFileSync(file);
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(0, 12);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(packed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    central.push(header, name);
    offset += 30 + name.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(outFile, Buffer.concat([...locals, dir, end]));
}
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

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

// Package Firefox .xpi
try {
  writeZip(resolve('cfchart.xpi'), resolve('dist'));
} catch (error) {
  throw new Error('Could not create cfchart.xpi', { cause: error });
}

// Package Chrome .zip
try {
  writeZip(resolve('cfchart-chrome.zip'), resolve('dist-chrome'));
} catch (error) {
  throw new Error('Could not create cfchart-chrome.zip', { cause: error });
}

console.log('\nCFChart is ready.\n- For Firefox: Load dist/manifest.json in about:debugging or install cfchart.xpi\n- For Chrome / Brave / Edge: Load dist-chrome/ as Unpacked Extension in chrome://extensions');

// Publish this feed alongside the exact XPI whose hash it describes.
const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (manifest.version !== packageVersion) throw new Error('Package and manifest versions must match.');
const gecko = manifest.browser_specific_settings.gecko;
const updates = { addons: { [gecko.id]: { updates: [{
  version: manifest.version,
  update_link: `https://github.com/sangiiko/CFChart/releases/download/v${manifest.version}/cfchart.xpi`,
  update_hash: `sha256:${createHash('sha256').update(readFileSync('cfchart.xpi')).digest('hex')}`,
  applications: { gecko: { strict_min_version: gecko.strict_min_version } },
}] } } };
writeFileSync('updates.json', JSON.stringify(updates, null, 2) + '\n');
