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
    console.log('=== Test : eval auth.uid() en authenticated, dans une eval directe ===');
    await sql
      .begin(async (tx) => {
        await tx`set local role authenticated`;
        const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
        await tx.unsafe(`set local "request.jwt.claims" = '${claims}'`);

        const [r1] = await tx`select auth.uid() as uid`;
        console.log('  auth.uid() ===', r1.uid);
        console.log('  type        ===', typeof r1.uid);

        const [r2] = await tx`select (${userId}::uuid = auth.uid()) as match`;
        console.log('  (input::uuid = auth.uid()) =', r2.match);

        // L'expression EXACTE de la with_check
        const [r3] = await tx`select (${userId}::uuid = auth.uid()) as with_check_value`;
        console.log('  WITH CHECK value:', r3.with_check_value);

        // current_user / role / session_user a ce moment
        const [r4] = await tx`select current_user, current_role, session_user`;
        console.log('  ', r4);

        throw new Error('__rb__');
      })
      .catch((e) => {
        if (e.message !== '__rb__') throw e;
      });

    console.log('\n=== Test : INSERT avec un EXPLAIN VERBOSE pour voir les checks ===');
    await sql
      .begin(async (tx) => {
        await tx`set local role authenticated`;
        const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
        await tx.unsafe(`set local "request.jwt.claims" = '${claims}'`);
        try {
          const plan = await tx.unsafe(`
          explain (verbose, format json)
          insert into public.households(name, owner_id)
          values ('Plan test', '${userId}'::uuid)
        `);
          console.log(JSON.stringify(plan, null, 2));
        } catch (e) {
          console.error('explain FAILED :', e.code, e.message);
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
