// Sobe o Postgres via docker compose quando houver Docker; senão a API cai no PGlite embutido.
import { execSync, spawn } from 'node:child_process';

const env = { ...process.env };
if (!env.DATABASE_URL) {
  try {
    execSync('docker compose up -d postgres', { stdio: 'inherit' });
    env.DATABASE_URL = 'postgres://abtest:abtest@localhost:5432/abtest';
  } catch {
    console.log('[dev] Docker indisponível — API usará PGlite (.data/pglite).');
  }
}
spawn('pnpm', ['exec', 'turbo', 'run', 'dev', '--parallel'], { stdio: 'inherit', env, shell: true }).on(
  'exit',
  (code) => process.exit(code ?? 0),
);
