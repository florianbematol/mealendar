#!/usr/bin/env node
/**
 * Reproduit l'INSERT households en SQL direct, avec un JWT user simule,
 * pour identifier precisement quelle policy bloque.
 *
 * Utilisation : pnpm db:test-insert <user_uuid>
 *   - user_uuid : un UUID valide d'un utilisateur auth.users existant
 *
 * Pour trouver un user_uuid : Dashboard Supabase -> Authentication -> Users.
 */

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
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    console.error('Usage : pnpm db:test-insert <user_uuid>');
    console.error('(trouvable dans Dashboard Supabase -> Authentication -> Users)');
    exit(1);
  }
  const cs = getCs();
  if (!cs) {
    console.error('Aucune SUPABASE_DB_URL dans apps/api/.dev.vars');
    exit(1);
  }

  const sql = postgres(cs, { ssl: 'require', prepare: false, max: 1, idle_timeout: 5 });

  try {
    console.log('=== Identite de connexion ===');
    const [identity] = await sql`select current_user, current_role, session_user`;
    console.log(identity);
    console.log('');

    console.log('=== bypassrls flag pour postgres / authenticator ===');
    const roles = await sql`
      select rolname, rolbypassrls
        from pg_roles
       where rolname in ('postgres','authenticator','authenticated','anon','service_role','supabase_admin')
       order by rolname
    `;
    for (const r of roles) {
      console.log(`  ${r.rolname}: bypassrls=${r.rolbypassrls}`);
    }
    console.log('');

    console.log(`=== Test INSERT en simulant le user ${userId} ===`);
    // On simule la session PostgREST :
    //   - rôle = authenticated
    //   - JWT claims = { sub: userId, role: authenticated }
    await sql
      .begin(async (tx) => {
        await tx`set local role authenticated`;
        const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
        await tx.unsafe(`set local "request.jwt.claims" = '${claims}'`);

        const [whoami] = await tx`select auth.uid() as uid, auth.role() as role`;
        console.log('  auth.uid()  =', whoami.uid);
        console.log('  auth.role() =', whoami.role);

        try {
          const [inserted] = await tx`
          insert into public.households(name, owner_id)
               values ('Test foyer', ${userId})
            returning id, name, owner_id, invite_code
        `;
          console.log('  INSERT OK :', inserted);
          // Rollback pour ne rien laisser
          throw new Error('__rollback__');
        } catch (e) {
          if (e.message === '__rollback__') throw e;
          console.error('  INSERT FAILED :', {
            code: e.code,
            message: e.message,
            detail: e.detail,
            hint: e.hint,
          });
          throw new Error('__rollback__');
        }
      })
      .catch((e) => {
        if (e.message !== '__rollback__') throw e;
      });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('Erreur :', err?.message ?? err);
  exit(1);
});
