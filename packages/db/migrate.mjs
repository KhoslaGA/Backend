import { readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const dir = new URL('./migrations/', import.meta.url).pathname;
execSync(`psql -h localhost -U rf -d ratefamily -c "CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, run_at timestamptz DEFAULT now())"`, { env: { ...process.env, PGPASSWORD: 'rf' }, stdio: 'inherit' });
const done = execSync(`psql -h localhost -U rf -d ratefamily -tAc "SELECT name FROM _migrations"`, { env: { ...process.env, PGPASSWORD: 'rf' } }).toString().split('\n').filter(Boolean);
for (const f of readdirSync(dir).filter(x => x.endsWith('.sql')).sort()) {
  if (done.includes(f)) { console.log('skip', f); continue; }
  console.log('apply', f);
  execSync(`psql -h localhost -U rf -d ratefamily -v ON_ERROR_STOP=1 -f "${dir}${f}" && psql -h localhost -U rf -d ratefamily -c "INSERT INTO _migrations(name) VALUES ('${f}')"`, { env: { ...process.env, PGPASSWORD: 'rf' }, stdio: 'inherit' });
}
