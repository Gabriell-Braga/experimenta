import { execSync } from 'node:child_process';

/** O snippet precisa estar compilado (dist/abt.js) antes dos testes. */
export default function globalSetup() {
  execSync('pnpm --filter @abtest/snippet build', { stdio: 'inherit', cwd: '..' });
}
