// Builds the website into _site at the repository root: the landing page, the screenshots and a live demo.
// Run it with `npm run site`, which builds the packages first.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const viewer = join(dirname(fileURLToPath(import.meta.url)), '..');
const repository = join(viewer, '..');
const output = join(repository, '_site');

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

cpSync(join(repository, 'site'), output, { recursive: true });
cpSync(join(repository, 'docs', 'screenshots'), join(output, 'screenshots'), { recursive: true });

// The demo has no API behind it here, so VITE_PAGES turns off what would need one.
execFileSync('npx', ['vite', 'build', '--base=./', `--outDir=${join(output, 'demo')}`, '--emptyOutDir'], {
  cwd: join(viewer, 'examples', 'react'),
  env: { ...process.env, VITE_PAGES: '1' },
  stdio: 'inherit',
  shell: true,
});

// Stops GitHub Pages from running the site through Jekyll.
writeFileSync(join(output, '.nojekyll'), '');
console.log(`Built ${output}`);
