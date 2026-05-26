import {
  CreateHouseholdInputSchema,
  type HouseholdDetail,
  type HouseholdSummary,
  JoinHouseholdInputSchema,
  type MeResponse,
} from '@mealendar/shared';
import { Hono } from 'hono';
import type { Bindings } from '../index';
import { toIsoString } from '../lib/dates';
import { getUserClient } from '../lib/supabase';
import { getAuth, requireAuth } from '../middleware/auth';

export const householdsRouter = new Hono<{ Bindings: Bindings }>();

householdsRouter.use('*', requireAuth());

/**
 * GET /api/whoami
 * Endpoint de debug : retourne ce que voit Postgres pour l'auth (auth.uid, role).
 * Utile pour diagnostiquer les erreurs RLS.
 */
householdsRouter.get('/whoami', async (c) => {
  const auth = getAuth(c);
  const sb = getUserClient(c.env, auth.accessToken);
  const { data, error } = await sb.rpc('whoami');
  return c.json({
    fromJwt: { userId: auth.userId, email: auth.email },
    fromPostgres: data,
    pgError: error?.message ?? null,
  });
});

/**
 * GET /api/me
 * Retourne l'utilisateur authentifie + ses foyers.
 */
householdsRouter.get('/me', async (c) => {
  const auth = getAuth(c);
  const sb = getUserClient(c.env, auth.accessToken);

  const { data, error } = await sb
    .from('household_members')
    .select(
      `role,
       household:households!inner(id, name, owner_id, created_at)`,
    )
    .eq('user_id', auth.userId);

  if (error) {
    console.error('[me] households query failed', error);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }

  type Row = {
    role: 'owner' | 'admin' | 'member';
    household: {
      id: string;
      name: string;
      owner_id: string;
      created_at: string;
    };
  };

  const households = (data as unknown as Row[]).map((r) => ({
    id: r.household.id,
    name: r.household.name,
    role: r.role,
    ownerId: r.household.owner_id,
    createdAt: toIsoString(r.household.created_at),
  }));

  const payload: MeResponse = {
    user: {
      id: auth.userId,
      email: auth.email ?? null,
    },
    households,
  };
  return c.json(payload);
});

/**
 * POST /api/households
 * Cree un nouveau foyer dont l'utilisateur est owner.
 * Le trigger Postgres ajoute auto le owner comme member 'owner'.
 */
householdsRouter.post('/households', async (c) => {
  const auth = getAuth(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = CreateHouseholdInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }

  const sb = getUserClient(c.env, auth.accessToken);

  const { data: created, error: insertError } = await sb.rpc('create_household', {
    p_name: parsed.data.name,
    p_display_name: parsed.data.displayName ?? null,
  });

  type RpcReturn = {
    id: string;
    name: string;
    owner_id: string;
    invite_code: string | null;
    created_at: string;
  };
  const row = created as unknown as RpcReturn | null;

  if (insertError || !row) {
    console.error('[households] create_household RPC failed', insertError);
    if (insertError?.code === '42703') {
      return c.json(
        {
          error: 'migration_missing',
          message:
            'Schema DB obsolete : applique la derniere migration Supabase (cf. supabase/migrations/).',
          dbMessage: insertError.message,
        },
        500,
      );
    }
    if (insertError?.code === '42501') {
      return c.json({ error: 'rls_violation', message: insertError.message }, 500);
    }
    return c.json({ error: 'db_error', message: insertError?.message }, 500);
  }

  const summary: HouseholdSummary = {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    inviteCode: row.invite_code,
    role: 'owner',
    createdAt: toIsoString(row.created_at),
  };
  return c.json(summary, 201);
});

/**
 * POST /api/households/join
 * Rejoint un foyer via son code d'invitation.
 */
householdsRouter.post('/households/join', async (c) => {
  const auth = getAuth(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = JoinHouseholdInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }

  const sb = getUserClient(c.env, auth.accessToken);

  const { data, error } = await sb.rpc('join_household_by_code', {
    p_invite_code: parsed.data.inviteCode,
    p_display_name: parsed.data.displayName ?? null,
  });

  if (error) {
    if (error.code === 'P0002') {
      return c.json({ error: 'invalid_code', message: "Code d'invitation invalide" }, 404);
    }
    console.error('[households/join] rpc failed', error);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }

  // La RPC retourne la ligne households (postgres row).
  type RpcReturn = {
    id: string;
    name: string;
    owner_id: string;
    invite_code: string | null;
    created_at: string;
  };
  const row = data as unknown as RpcReturn;

  const summary: HouseholdSummary = {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    inviteCode: row.invite_code,
    role: 'member',
    createdAt: toIsoString(row.created_at),
  };
  return c.json(summary, 200);
});

// ============================================================================
// GET /api/households/:id : detail complet (membres + invite_code)
// ============================================================================
householdsRouter.get('/households/:id', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);
  const sb = getUserClient(c.env, auth.accessToken);
  const { data, error } = await sb.rpc('get_household_detail', { p_household_id: id });
  if (error) {
    console.error('[households] get_detail RPC failed', error);
    if (error.code === 'P0002') return c.json({ error: 'not_found' }, 404);
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  type RpcReturn = {
    id: string;
    name: string;
    ownerId: string;
    inviteCode: string | null;
    createdAt: string;
    members: {
      userId: string;
      role: 'owner' | 'admin' | 'member';
      displayName: string | null;
      email: string | null;
      joinedAt: string;
    }[];
  };
  const row = data as unknown as RpcReturn;
  const payload: HouseholdDetail = {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    inviteCode: row.inviteCode,
    createdAt: toIsoString(row.createdAt),
    members: (row.members ?? []).map((m) => ({
      userId: m.userId,
      role: m.role,
      displayName: m.displayName,
      email: m.email,
      joinedAt: toIsoString(m.joinedAt),
    })),
  };
  return c.json(payload);
});

// ============================================================================
// POST /api/households/:id/leave : quitter le foyer
// ============================================================================
householdsRouter.post('/households/:id/leave', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);
  const sb = getUserClient(c.env, auth.accessToken);
  const { error } = await sb.rpc('leave_household', { p_household_id: id });
  if (error) {
    if (error.code === '42501') return c.json({ error: 'forbidden', message: error.message }, 403);
    if (error.code === 'P0002') return c.json({ error: 'not_found' }, 404);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json({ ok: true });
});

// ============================================================================
// DELETE /api/households/:id : supprime le foyer (owner uniquement)
// Cascade : membres, recettes, plannings, meal_plans, favoris, etc.
// ============================================================================
householdsRouter.delete('/households/:id', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);
  const sb = getUserClient(c.env, auth.accessToken);
  const { error } = await sb.rpc('delete_household', { p_household_id: id });
  if (error) {
    console.error('[households] delete RPC failed', error);
    if (error.code === '42501') return c.json({ error: 'forbidden', message: error.message }, 403);
    if (error.code === 'P0002') return c.json({ error: 'not_found' }, 404);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json({ ok: true });
});

// ============================================================================
// POST /api/households/:id/regenerate-invite-code (owner/admin)
// ============================================================================
householdsRouter.post('/households/:id/regenerate-invite-code', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);
  const sb = getUserClient(c.env, auth.accessToken);
  const { data, error } = await sb.rpc('regenerate_invite_code', { p_household_id: id });
  if (error) {
    console.error('[households] regenerate_invite_code RPC failed', error);
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json({ inviteCode: data as string });
});
