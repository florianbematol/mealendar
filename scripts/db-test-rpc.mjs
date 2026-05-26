#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { argv, env, exit } from 'node:process';
import postgres from 'postgres';

const ROOT = resolve(import.meta.dirname, '..');
const DEV_VARS_FILE = join(ROOT, 'apps', 'api', '.dev.vars');

function parseDevVars() {
  if (!existsSync(DEV_VARS_FILE)) return {};
  const text = readFileSync(DEV_VARS_FILE, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}
function getCs() {
  const fromEnv = env.SUPABASE_DB_URL ?? env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  const dv = parseDevVars();
  return dv.SUPABASE_DB_URL ?? dv.DATABASE_URL ?? null;
}

async function main() {
  const userId = argv[2];
  if (!userId) {
    console.error('Usage : node scripts/db-test-rpc.mjs <user_uuid>');
    exit(1);
  }
  const sql = postgres(getCs(), { ssl: 'require', prepare: false, max: 1, idle_timeout: 5 });
  try {
    console.log('=== Test : appel RPC create_household en simulation authenticated ===');
    await sql
      .begin(async (tx) => {
        await tx`set local role authenticated`;
        const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
        await tx.unsafe(`set local "request.jwt.claims" = '${claims}'`);

        try {
          const [r] = await tx`select * from public.create_household('Test foyer', 'Florian')`;
          console.log('  RPC OK :', r);
        } catch (e) {
          console.error('  RPC FAILED :', e.code, e.message);
        }
        throw new Error('__rb__');
      })
      .catch((e) => {
        if (e.message !== '__rb__') throw e;
      });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  exit(1);
});
