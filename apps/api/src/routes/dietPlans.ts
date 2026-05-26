/**
 * Endpoints pour les profils dietetiques par membre (Phase 5.5).
 *
 * Routes :
 *  - GET    /api/me/diet-plan?householdId=...   : mon profil dans un foyer
 *  - PUT    /api/me/diet-plan                   : upsert mon profil (corps + householdId)
 *  - GET    /api/households/:id/diet-plans      : tous les profils du foyer (lecture)
 */
import {
  type HouseholdDietPlansResponse,
  UpsertUserDietPlanInputSchema,
  type UserDietPlan,
  UserDietPlanSchema,
} from '@mealendar/shared';
import { Hono } from 'hono';
import type { Bindings } from '../index';
import { toIsoString } from '../lib/dates';
import { getUserClient } from '../lib/supabase';
import { getAuth, requireAuth } from '../middleware/auth';

export const dietPlansRouter = new Hono<{ Bindings: Bindings }>();

dietPlansRouter.use('*', requireAuth());

/**
 * Format ligne brute Postgres -> UserDietPlan (camelCase + dates ISO strict).
 */
type DietPlanRow = {
  id: string;
  user_id: string;
  user_email?: string | null;
  household_id: string;
  diet_plan: unknown;
  regimes: string[] | null;
  allergies: string[] | null;
  goals: string[] | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function mapRow(r: DietPlanRow): UserDietPlan {
  const mapped = {
    id: r.id,
    userId: r.user_id,
    userEmail: r.user_email ?? null,
    householdId: r.household_id,
    dietPlan: r.diet_plan,
    regimes: r.regimes ?? [],
    allergies: r.allergies ?? [],
    goals: r.goals ?? [],
    createdAt: toIsoString(r.created_at),
    updatedAt: toIsoString(r.updated_at),
  };
  // Validation Zod stricte (typage de retour propre)
  return UserDietPlanSchema.parse(mapped);
}

// ============================================================================
// GET /api/me/diet-plan?householdId=...
// ============================================================================
dietPlansRouter.get('/me/diet-plan', async (c) => {
  const auth = getAuth(c);
  const householdId = c.req.query('householdId');
  if (!householdId) {
    return c.json({ error: 'missing_household_id' }, 400);
  }
  const sb = getUserClient(c.env, auth.accessToken);
  const { data, error } = await sb.rpc('get_my_diet_plan', { p_household_id: householdId });
  if (error) {
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    console.error('[diet-plans] get_my_diet_plan failed', error);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  if (!data) {
    // Pas encore de profil pour ce user dans ce foyer
    return c.json(null);
  }
  return c.json(mapRow(data as unknown as DietPlanRow));
});

// ============================================================================
// PUT /api/me/diet-plan
// ============================================================================
dietPlansRouter.put('/me/diet-plan', async (c) => {
  const auth = getAuth(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = UpsertUserDietPlanInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const sb = getUserClient(c.env, auth.accessToken);
  const { data, error } = await sb.rpc('upsert_user_diet_plan', {
    p_household_id: parsed.data.householdId,
    p_diet_plan: parsed.data.dietPlan,
    p_regimes: parsed.data.regimes,
    p_allergies: parsed.data.allergies,
    p_goals: parsed.data.goals,
  });
  if (error) {
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    console.error('[diet-plans] upsert_user_diet_plan failed', error);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json(mapRow(data as unknown as DietPlanRow));
});

// ============================================================================
// GET /api/households/:id/diet-plans
// ============================================================================
dietPlansRouter.get('/households/:id/diet-plans', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);

  const sb = getUserClient(c.env, auth.accessToken);
  const { data, error } = await sb.rpc('list_household_diet_plans', { p_household_id: id });
  if (error) {
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    console.error('[diet-plans] list_household_diet_plans failed', error);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  const items = ((data ?? []) as unknown as DietPlanRow[]).map(mapRow);
  const payload: HouseholdDietPlansResponse = { items };
  return c.json(payload);
});
