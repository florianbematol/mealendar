#!/usr/bin/env node
/**
 * Applique les migrations SQL Mealendar sur la DB Supabase distante.
 *
 * Lit la connection string depuis :
 *   1. SUPABASE_DB_URL (env)                                          [recommande]
 *   2. ./apps/api/.dev.vars -> SUPABASE_DB_URL                        [fallback]
 *
 * Utilisation :
 *   pnpm db:push                       # applique toutes les migrations en attente
 *   pnpm db:status                     # liste sans appliquer (alias --dry-run)
 *   pnpm db:reset                      # drop le tracking + re-applique tout
 *   pnpm db:push --mark <filename>     # marque une migration comme deja appliquee
 *                                       (sans executer le SQL). Utile si on a
 *                                       applique une migration via le SQL Editor.
 *
 * Comment trouver la connection string Supabase :
 *   Dashboard -> Settings -> Database -> Connection string -> URI
 *   Choisir le pool "Session" ou "Direct" (port 5432). Mot de passe = celui
 *   du projet Supabase (pas l'anon key !).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { argv, env, exit } from 'node:process';
import postgres from 'postgres';

const ROOT = resolve(import.meta.dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
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

function listMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) {
    console.error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
    exit(1);
  }
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function main() {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const reset = args.includes('--reset');
  const markIdx = args.indexOf('--mark');
  const markName = markIdx >= 0 ? args[markIdx + 1] : null;

  const connectionString = getConnectionString();
  if (!connectionString) {
    console.error(
      [
        'Aucune connection string trouvee.',
        '',
        'Solutions :',
        '  1. Definir SUPABASE_DB_URL dans apps/api/.dev.vars',
        '  2. Ou exporter SUPABASE_DB_URL=... avant de lancer la commande',
        '',
        'URL au format : postgres://postgres.<ref>:<password>@<host>:5432/postgres',
        '  Dashboard Supabase -> Settings -> Database -> Connection string -> URI',
      ].join('\n'),
    );
    exit(1);
  }

  const migrations = listMigrations();
  console.log(`${migrations.length} migration(s) trouvee(s) dans ${MIGRATIONS_DIR}`);

  const sql = postgres(connectionString, {
    ssl: 'require',
    prepare: false,
    max: 1,
    idle_timeout: 5,
    // Silence les NOTICE Postgres (tres verbeux pour les migrations idempotentes :
    // "table X already exists, skipping" etc.). Les vraies erreurs sont toujours throw.
    onnotice: () => {},
  });

  try {
    if (reset) {
      console.log('-> RESET : drop table _mealendar_migrations');
      await sql`drop table if exists public._mealendar_migrations`;
    }

    await sql`
      create table if not exists public._mealendar_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    // Mode --mark <filename> : enregistre une migration comme appliquee sans
    // executer son SQL. Utile quand on a applique une migration via le SQL Editor.
    if (markName) {
      if (!migrations.includes(markName)) {
        console.error(`Migration introuvable : ${markName}`);
        console.error('Migrations disponibles :');
        for (const m of migrations) console.error(`  - ${m}`);
        exit(1);
      }
      await sql`
        insert into public._mealendar_migrations(name)
             values (${markName})
        on conflict (name) do nothing
      `;
      console.log(`Marquee comme appliquee : ${markName}`);
      return;
    }

    const applied = await sql`select name from public._mealendar_migrations`;
    const appliedSet = new Set(applied.map((r) => r.name));

    const pending = migrations.filter((m) => !appliedSet.has(m));
    if (pending.length === 0) {
      console.log('Toutes les migrations sont a jour.');
      return;
    }

    console.log(`${pending.length} migration(s) a appliquer :`);
    for (const m of pending) console.log(`  - ${m}`);

    if (dryRun) {
      console.log('\n--dry-run : aucun changement effectue.');
      return;
    }

    for (const m of pending) {
      const file = join(MIGRATIONS_DIR, m);
      const content = readFileSync(file, 'utf8');
      console.log(`\n>> Applying ${m}...`);
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(content);
          await tx`insert into public._mealendar_migrations(name) values (${m})`;
        });
        console.log('   OK');
      } catch (e) {
        console.error(`   FAILED: ${e?.message ?? e}`);
        throw e;
      }
    }

    console.log('\nToutes les migrations ont ete appliquees avec succes.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('\nErreur :', err?.message ?? err);
  exit(1);
});
