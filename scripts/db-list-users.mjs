#!/usr/bin/env node
/**
 * Liste les utilisateurs auth.users (pour debug, sur la base distante).
 *
 * Utilisation : pnpm db:list-users
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
  const cs = getCs();
  if (!cs) {
    console.error('Aucune SUPABASE_DB_URL dans apps/api/.dev.vars');
    exit(1);
  }
  const sql = postgres(cs, { ssl: 'require', prepare: false, max: 1, idle_timeout: 5 });
  try {
    const rows = await sql`
      select id, email, email_confirmed_at, created_at
        from auth.users
       order by created_at desc
       limit 50
    `;
    if (rows.length === 0) {
      console.log('Aucun utilisateur dans auth.users.');
      return;
    }
    for (const r of rows) {
      const confirmed = r.email_confirmed_at ? '[confirmed]' : '[NOT confirmed]';
      console.log(`${r.id}  ${r.email ?? '(no email)'}  ${confirmed}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('Erreur :', err?.message ?? err);
  exit(1);
});
