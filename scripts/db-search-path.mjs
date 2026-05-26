#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { env, exit } from 'node:process';
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
  const userId = '38fb23b8-1729-41f5-a7f3-4882730aec68';
  const sql = postgres(getCs(), { ssl: 'require', prepare: false, max: 1, idle_timeout: 5 });
  try {
    await sql
      .begin(async (tx) => {
        await tx`set local role authenticated`;
        const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
        await tx.unsafe(`set local "request.jwt.claims" = '${claims}'`);

        const sp = await tx`show search_path`;
        console.log('search_path =', sp);

        const priv = await tx`
        select
          has_table_privilege('public.households','INSERT') as insert_ok,
          has_table_privilege('public.households','SELECT') as select_ok,
          has_function_privilege('auth.uid()','EXECUTE') as auth_uid_ok
      `;
        console.log('privileges =', priv);

        // Resolution de auth.uid() avec le search_path actuel ?
        const fn = await tx`
        select n.nspname || '.' || p.proname as fname
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where p.proname = 'uid' and n.nspname = 'auth'
      `;
        console.log('auth.uid() exists at:', fn);

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
