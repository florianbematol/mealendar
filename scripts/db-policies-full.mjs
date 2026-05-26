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
  const sql = postgres(getCs(), { ssl: 'require', prepare: false, max: 1, idle_timeout: 5 });
  try {
    console.log('=== ALL policies (incl. restrictive) on households ===');
    const rows = await sql`
      select polname,
             polcmd,
             polpermissive,
             polroles::regrole[]::text[] as roles,
             pg_get_expr(polqual, polrelid) as qual,
             pg_get_expr(polwithcheck, polrelid) as with_check
        from pg_policy
       where polrelid = 'public.households'::regclass
       order by polpermissive desc, polcmd, polname
    `;
    for (const p of rows) {
      console.log(
        `${p.polname} [${p.polpermissive ? 'PERMISSIVE' : 'RESTRICTIVE'}] cmd=${p.polcmd} roles=${p.roles}`,
      );
      if (p.qual) console.log(`  USING      = ${p.qual}`);
      if (p.with_check) console.log(`  WITH CHECK = ${p.with_check}`);
    }
    console.log(`\nTotal: ${rows.length} policy(ies)`);

    console.log('\n=== relrowsecurity / relforcerowsecurity ===');
    const meta = await sql`
      select c.relname,
             c.relrowsecurity,
             c.relforcerowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname in ('households','household_members')
    `;
    for (const r of meta) console.log(r);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.error(e?.message);
  exit(1);
});
