// Builds an installable file for each package, for apps to install until the packages are on npm.
// Run it with `npm run pack`, which builds them first. The files end up in viewer/release.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'release');

// Angular's package is published from its build output, and the others from their own folders.
const packages = ['packages/core', 'packages/editor', 'packages/react', 'packages/vue', 'packages/angular/dist'];

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const folder of packages) {
  execFileSync('npm', ['pack', '--silent', '--pack-destination', output], { cwd: join(root, folder), stdio: 'ignore', shell: true });
}

for (const file of readdirSync(output)) console.log(`viewer/release/${file}`);
