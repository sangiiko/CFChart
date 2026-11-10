import { execSync } from 'child_process';
import { resolve } from 'path';

console.log('🚀 Building CFChart Firefox Extension...');

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

// 1. Typecheck and build HTML pages (popup and dashboard) with Vite
run('tsc');
run('vite build');

// 2. Bundle self-contained content.js and background.js for Firefox Extension
run('npx esbuild src/content/index.tsx --bundle --minify --outfile=dist/content.js --define:process.env.NODE_ENV=\\"production\\"');
run('npx esbuild src/background/index.ts --bundle --minify --outfile=dist/background.js --define:process.env.NODE_ENV=\\"production\\"');

// 3. Compile content.css using Tailwind
run('npx tailwindcss -i src/index.css -o dist/content.css --minify');

console.log('\n✨ CFChart extension build complete in dist/ directory!');
