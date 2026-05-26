#!/usr/bin/env node
/**
 * Reproduit pas-a-pas l'INSERT households + decompose chaque check RLS.
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
  const userId = '38fb23b8-1729-41f5-a7f3-4882730aec68';
  const sql = postgres(getCs(), { ssl: 'require', prepare: false, max: 1, idle_timeout: 5 });
  try {
    console.log('=== Toutes les policies sur households ===');
    const allPolicies = await sql`
      select polname, polcmd, polpermissive, polroles::regrole[] as roles,
             pg_get_expr(polqual, polrelid) as qual,
             pg_get_expr(polwithcheck, polrelid) as with_check
        from pg_policy
       where polrelid = 'public.households'::regclass
       order by polcmd, polname
    `;
    for (const p of allPolicies) {
      console.log(p);
    }

    console.log('\n=== Test 1 : disable RLS, INSERT en authenticated ===');
    await sql
      .begin(async (tx) => {
        await tx`alter table public.households disable row level security`;
        await tx`set local role authenticated`;
        const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
        await tx.unsafe(`set local "request.jwt.claims" = '${claims}'`);
        try {
          const [r] = await tx`
          insert into public.households(name, owner_id)
          values ('Test no-RLS', ${userId})
          returning id, name, owner_id, invite_code
        `;
          console.log('  INSERT (RLS off) OK :', r);
        } catch (e) {
          console.error('  INSERT (RLS off) FAILED :', e.code, e.message);
        }
        throw new Error('__rb__');
      })
      .catch((e) => {
        if (e.message !== '__rb__') throw e;
      });

    console.log('\n=== Test 2 : RLS on, simulation user, eval manuelle de chaque policy ===');
    await sql
      .begin(async (tx) => {
        await tx`set local role authenticated`;
        const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
        await tx.unsafe(`set local "request.jwt.claims" = '${claims}'`);

        for (const p of allPolicies) {
          const expr = p.with_check ?? p.qual;
          if (!expr) continue;
          // On evalue l'expression contre des valeurs simulees
          // Note : on ne peut pas reellement evaluer with_check sans le NEW. context.
          console.log(`  ${p.polname} (${p.polcmd})`);
          console.log(`    expr = ${expr}`);
          if (p.polcmd === 'a' /* INSERT */ || p.polcmd === '*' /* ALL */) {
            // Substitue les references a NEW.* ou aux colonnes par la valeur testee
            const testExpr = expr
              .replaceAll(/\bowner_id\b/g, `'${userId}'::uuid`)
              .replaceAll(/\bid\b(?!_)/g, 'uuid_generate_v4()');
            try {
              const [r] = await tx.unsafe(`select (${testExpr}) as result`);
              console.log(`    eval = ${r.result}`);
            } catch (e) {
              console.log(`    eval ERROR : ${e.message}`);
            }
          }
        }
        throw new Error('__rb__');
      })
      .catch((e) => {
        if (e.message !== '__rb__') throw e;
      });

    console.log(
      '\n=== Test 3 : INSERT avec RLS, mais en BYPASSING via sql.begin sans set role ===',
    );
    await sql
      .begin(async (tx) => {
        try {
          const [r] = await tx`
          insert into public.households(name, owner_id)
          values ('Test as postgres', ${userId})
          returning id, name, owner_id, invite_code
        `;
          console.log('  INSERT (postgres role) OK :', r);
        } catch (e) {
          console.error('  INSERT (postgres role) FAILED :', e.code, e.message);
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

main().catch((err) => {
  console.error('Erreur :', err?.message ?? err);
  exit(1);
});
