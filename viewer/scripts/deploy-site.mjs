// Publishes _site to the gh-pages branch, which GitHub Pages serves. Run `npm run site` first.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const site = join(repository, '_site');
if (!existsSync(join(site, 'index.html'))) throw new Error('Nothing to publish. Run `npm run site` first.');

const inRepository = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
const remote = inRepository('remote', 'get-url', 'origin');
// Commits here use this repository's identity, not whatever is set globally.
const identity = ['-c', `user.name=${inRepository('config', 'user.name')}`, '-c', `user.email=${inRepository('config', 'user.email')}`];
const source = inRepository('rev-parse', '--short', 'HEAD');

const folder = mkdtempSync(join(tmpdir(), 'pdf-suite-pages-'));
const git = (...args) => execFileSync('git', args, { cwd: folder, stdio: 'inherit' });

try {
  const exists = execFileSync('git', ['ls-remote', '--heads', remote, 'gh-pages'], { encoding: 'utf8' }).trim() !== '';
  if (exists) {
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', 'gh-pages', remote, folder], { stdio: 'inherit' });
  } else {
    git('init', '--quiet', '--initial-branch=gh-pages');
    git('remote', 'add', 'origin', remote);
  }

  for (const name of readdirSync(folder)) {
    if (name !== '.git') rmSync(join(folder, name), { recursive: true, force: true });
  }
  cpSync(site, folder, { recursive: true });

  git('add', '--all');
  if (execFileSync('git', ['status', '--porcelain'], { cwd: folder, encoding: 'utf8' }).trim() === '') {
    console.log('The site is already up to date.');
  } else {
    git(...identity, 'commit', '--quiet', '-m', `Publish the site from ${source}`);
    git('push', '--quiet', 'origin', 'HEAD:gh-pages');
    console.log('Published to the gh-pages branch.');
  }
} finally {
  rmSync(folder, { recursive: true, force: true });
}
