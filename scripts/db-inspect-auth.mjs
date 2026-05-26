#!/usr/bin/env node
/**
 * Inspecte la fonction auth.uid() pour debug RLS.
 */

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
  const sql = postgres(getCs(), { ssl: 'require', prepare: false, max: 1, idle_timeout: 5 });
  try {
    console.log('=== auth.uid() definition ===');
    const fn = await sql`
      select pg_get_functiondef(p.oid) as def
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'auth' and p.proname = 'uid'
    `;
    for (const row of fn) console.log(row.def);

    console.log('\n=== auth.uid() return type ===');
    const ret = await sql`
      select pg_get_function_result(p.oid) as ret_type
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'auth' and p.proname = 'uid'
    `;
    for (const row of ret) console.log(row.ret_type);

    console.log('\n=== Test simulation user + intermediate values ===');
    const userId = '38fb23b8-1729-41f5-a7f3-4882730aec68';
    await sql
      .begin(async (tx) => {
        await tx`set local role authenticated`;
        const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
        await tx.unsafe(`set local "request.jwt.claims" = '${claims}'`);
        const [r] = await tx`
        select
          auth.uid()                            as uid,
          pg_typeof(auth.uid())                 as uid_type,
          ${userId}::uuid                       as input_uuid,
          ${userId}::uuid = auth.uid()          as match_check,
          (auth.uid() is null)                  as uid_is_null,
          current_setting('request.jwt.claims', true) as raw_claims
      `;
        console.log(r);
        throw new Error('__rb__');
      })
      .catch((e) => {
        if (e.message !== '__rb__') throw e;
      });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('Erreur :', err?.message ?? err);
  exit(1);
});
