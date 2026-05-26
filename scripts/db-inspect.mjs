#!/usr/bin/env node
/**
 * Inspecte les RLS policies actives sur les tables Mealendar.
 * Utile pour diagnostiquer "new row violates row-level security policy".
 *
 * Utilisation : pnpm db:inspect
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

function getConnectionString() {
  const fromEnv = env.SUPABASE_DB_URL ?? env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  const dv = parseDevVars();
  return dv.SUPABASE_DB_URL ?? dv.DATABASE_URL ?? null;
}

async function main() {
  const cs = getConnectionString();
  if (!cs) {
    console.error('Aucune SUPABASE_DB_URL dans apps/api/.dev.vars');
    exit(1);
  }
  const sql = postgres(cs, { ssl: 'require', prepare: false, max: 1, idle_timeout: 5 });

  try {
    console.log('=== Policies RLS sur households / household_members ===\n');
    const policies = await sql`
      select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
        from pg_policies
       where tablename in ('households','household_members')
       order by tablename, cmd, policyname
    `;
    for (const p of policies) {
      console.log(`${p.tablename}.${p.policyname}`);
      console.log(`  cmd        = ${p.cmd}`);
      console.log(`  permissive = ${p.permissive}`);
      console.log(`  roles      = ${JSON.stringify(p.roles)}`);
      if (p.qual) console.log(`  USING      = ${p.qual}`);
      if (p.with_check) console.log(`  WITH CHECK = ${p.with_check}`);
      console.log('');
    }

    console.log('=== Triggers actifs ===\n');
    const triggers = await sql`
      select event_object_schema as schema, event_object_table as table, trigger_name, action_timing, event_manipulation
        from information_schema.triggers
       where event_object_table in ('households','household_members')
       order by event_object_table, action_timing, trigger_name
    `;
    for (const t of triggers) {
      console.log(`${t.table}.${t.trigger_name}  [${t.action_timing} ${t.event_manipulation}]`);
    }

    console.log('\n=== Privileges sur les tables ===\n');
    const privs = await sql`
      select grantee, privilege_type
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name in ('households','household_members')
         and grantee in ('anon','authenticated','service_role','public')
       order by table_name, grantee, privilege_type
    `;
    const byTable = {};
    for (const p of privs) {
      const key = p.grantee;
      byTable[key] = byTable[key] ?? [];
      byTable[key].push(p.privilege_type);
    }
    for (const [grantee, perms] of Object.entries(byTable)) {
      console.log(`  ${grantee}: ${[...new Set(perms)].sort().join(', ')}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('Erreur :', err?.message ?? err);
  exit(1);
});
