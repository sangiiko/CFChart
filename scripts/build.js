import { execSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, cpSync } from 'fs';
import { resolve } from 'path';

console.log('🚀 Building CFChart Firefox Extension...');

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

// 1. Typecheck & Vite build for HTML pages
run('tsc');
run('vite build');

// 2. Bundle standalone content.js and background.js into dist/
run('npx esbuild src/content/index.tsx --bundle --minify --outfile=dist/content.js --define:process.env.NODE_ENV=\\"production\\"');
run('npx esbuild src/background/index.ts --bundle --minify --outfile=dist/background.js --define:process.env.NODE_ENV=\\"production\\"');

// 3. Compile content.css into dist/
run('npx tailwindcss -i src/index.css -o dist/content.css --minify');

// 4. Parity Sync: Copy compiled artifacts to repository root so loading EITHER root or dist/ works identically!
console.log('\n📦 Synchronizing root directory for dual-manifest support...');
copyFileSync('dist/content.js', 'content.js');
copyFileSync('dist/background.js', 'background.js');
copyFileSync('dist/content.css', 'content.css');
copyFileSync('public/manifest.json', 'manifest.json');
copyFileSync('dist/popup.html', 'popup.html');
copyFileSync('dist/dashboard.html', 'dashboard.html');

if (existsSync('dist/icons')) {
  cpSync('dist/icons', 'icons', { recursive: true });
}
if (existsSync('dist/assets')) {
  cpSync('dist/assets', 'assets', { recursive: true });
}

console.log('\n✨ CFChart extension build complete! Both ./ and dist/ are valid extension directories.');
