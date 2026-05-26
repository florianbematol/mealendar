#!/usr/bin/env node
/**
 * Test minimaliste : INSERT en simulant authenticated, sans triggers,
 * pour isoler le souci.
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
    console.log('=== Test A : INSERT sans triggers ===');
    await sql
      .begin(async (tx) => {
        await tx`alter table public.households disable trigger trg_set_invite_code`;
        await tx`alter table public.households disable trigger trg_add_owner_as_member`;
        await tx`set local role authenticated`;
        const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
        await tx.unsafe(`set local "request.jwt.claims" = '${claims}'`);
        const [whoami] = await tx`select auth.uid()::text as uid, auth.role() as role`;
        console.log('  whoami:', whoami);

        try {
          const [r] = await tx`
          insert into public.households(name, owner_id, invite_code)
          values ('Test no-triggers', ${userId}, 'TESTCODE')
          returning id, name, owner_id
        `;
          console.log('  INSERT OK :', r);
        } catch (e) {
          console.error('  INSERT FAILED :', e.code, e.message);
        }
        throw new Error('__rb__');
      })
      .catch((e) => {
        if (e.message !== '__rb__') throw e;
      });

    console.log('\n=== Test B : INSERT avec trigger BEFORE seul ===');
    await sql
      .begin(async (tx) => {
        await tx`alter table public.households enable trigger trg_set_invite_code`;
        await tx`alter table public.households disable trigger trg_add_owner_as_member`;
        await tx`set local role authenticated`;
        const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
        await tx.unsafe(`set local "request.jwt.claims" = '${claims}'`);

        try {
          const [r] = await tx`
          insert into public.households(name, owner_id)
          values ('Test before-only', ${userId})
          returning id, name, owner_id, invite_code
        `;
          console.log('  INSERT OK :', r);
        } catch (e) {
          console.error('  INSERT FAILED :', e.code, e.message);
        }
        throw new Error('__rb__');
      })
      .catch((e) => {
        if (e.message !== '__rb__') throw e;
      });

    console.log('\n=== Test C : INSERT avec les deux triggers (cas reel) ===');
    await sql
      .begin(async (tx) => {
        await tx`set local role authenticated`;
        const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
        await tx.unsafe(`set local "request.jwt.claims" = '${claims}'`);

        try {
          const [r] = await tx`
          insert into public.households(name, owner_id)
          values ('Test full', ${userId})
          returning id, name, owner_id, invite_code
        `;
          console.log('  INSERT OK :', r);
        } catch (e) {
          console.error('  INSERT FAILED :', e.code, e.message);
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
