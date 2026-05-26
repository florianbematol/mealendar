#!/usr/bin/env node
/**
 * Drop tout le schema public Mealendar et la table de tracking des migrations.
 *
 * UTILISER AVEC PRECAUTION : detruit toutes les donnees applicatives (foyers,
 * recettes, plannings, etc.). Les comptes auth.users de Supabase ne sont PAS
 * touches (ils vivent dans le schema auth, pas public).
 *
 * Apres un wipe, lancer `pnpm db:push` pour re-creer le schema.
 *
 * Utilisation :
 *   pnpm db:wipe          # demande confirmation interactive
 *   pnpm db:wipe --yes    # skip la confirmation (CI / scripting)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { argv, env, exit, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';
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
  if (dv.SUPABASE_DB_URL) return dv.SUPABASE_DB_URL;
  if (dv.DATABASE_URL) return dv.DATABASE_URL;
  return null;
}

function ask(question) {
  return new Promise((res) => {
    const rl = createInterface({ input: stdin, output: stdout });
    rl.question(question, (answer) => {
      rl.close();
      res(answer);
    });
  });
}

async function main() {
  const args = argv.slice(2);
  const skipConfirm = args.includes('--yes') || args.includes('-y');

  const connectionString = getConnectionString();
  if (!connectionString) {
    console.error('Aucune connection string trouvee. Voir scripts/db-push.mjs.');
    exit(1);
  }

  if (!skipConfirm) {
    console.log('Cette commande va DROP toutes les tables Mealendar du schema public');
    console.log('et reinitialiser la table de tracking des migrations.');
    console.log('Les comptes auth.users ne sont PAS touches.');
    console.log('');
    const answer = await ask('Tape "WIPE" pour confirmer : ');
    if (answer.trim() !== 'WIPE') {
      console.log('Annule.');
      exit(0);
    }
  }

  const sql = postgres(connectionString, {
    ssl: 'require',
    prepare: false,
    max: 1,
    idle_timeout: 5,
    onnotice: () => {},
  });

  try {
    console.log('-> Drop des objets Mealendar...');

    // Drop dans l'ordre (FK dependencies)
    await sql`drop trigger if exists trg_add_owner_as_member on public.households`;
    await sql`drop trigger if exists trg_set_invite_code on public.households`;

    await sql`drop function if exists public.add_owner_as_member() cascade`;
    await sql`drop function if exists public.set_invite_code_if_null() cascade`;
    await sql`drop function if exists public.generate_invite_code() cascade`;
    await sql`drop function if exists public.is_household_admin(uuid) cascade`;
    await sql`drop function if exists public.is_household_member(uuid) cascade`;
    await sql`drop function if exists public.join_household_by_code(text, text) cascade`;
    await sql`drop function if exists public.whoami() cascade`;

    await sql`drop table if exists public.household_members cascade`;
    await sql`drop table if exists public.households cascade`;

    await sql`drop type if exists public.household_role cascade`;

    await sql`drop table if exists public._mealendar_migrations cascade`;

    console.log('OK. Lance maintenant `pnpm db:push` pour recreer le schema.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('\nErreur :', err?.message ?? err);
  exit(1);
});
