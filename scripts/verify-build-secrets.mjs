import nextEnv from '@next/env';
import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Values remain inside this process; output contains only counts and filenames.
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const names = ['CLERK_SECRET_KEY', 'CLERK_WEBHOOK_SECRET', 'MONGODB_URI', 'RESEND_API_KEY'];
const secretValues = new Set();
const publicSecrets = new Set();
function collect() {
  for (const name of names) if (process.env[name]?.length >= 12) secretValues.add(process.env[name]);
  for (const name of Object.keys(process.env)) if (name.startsWith('NEXT_PUBLIC_') && /(SECRET|PASSWORD|TOKEN|PRIVATE_KEY|MONGODB_URI|RESEND_API_KEY)/i.test(name) && process.env[name]) publicSecrets.add(name);
}
collect();
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} }, true);
collect();
const configured = [...secretValues].map(value => Buffer.from(value));
const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const trackedEnv = tracked.filter(file => /(^|\/)\.env(?:\.|$)/.test(file) && file !== '.env.example');
const leakedFiles = [];
let checked = 0;
let repositoryFilesChecked = 0;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await inspect(file); continue; }
    const contents = await readFile(file);
    checked++;
    if (configured.some(secret => contents.includes(secret))) leakedFiles.push(path.relative(process.cwd(), file));
  }
}
await inspect(path.resolve('.next/static'));
for (const file of tracked) {
  const contents = await readFile(file);
  repositoryFilesChecked++;
  if (configured.some(secret => contents.includes(secret))) leakedFiles.push(file);
}
const failures = [...trackedEnv, ...publicSecrets, ...leakedFiles];
if (failures.length) {
  console.error(JSON.stringify({ error: 'Possível exposição de segredo; revisar antes da publicação.', filesOrVariableNames: failures }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ passed: true, publicBuildFilesChecked: checked, repositoryFilesChecked, configuredSecretsChecked: configured.length, trackedPrivateEnvFiles: 0, exposedSecrets: 0 }));
}
