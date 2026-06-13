import {
  CreateMealPlanRangeInputSchema,
  DuplicateMealsRangeInputSchema,
  type DuplicateMealsRangeResponse,
  type MealPlanRange,
  UpdateMealPlanRangeInputSchema,
} from '@mealendar/shared';
import { Hono } from 'hono';
import type { Bindings } from '../index';
import { toIsoString } from '../lib/dates';
import { getUserClient } from '../lib/supabase';
import { getAuth, requireAuth } from '../middleware/auth';

/**
 * Routes "plages de repas" : objets persistes qui marquent une fenetre
 * [date_from, date_to] sur le calendrier. Les repas eux-memes restent dans
 * planned_meals.
 *
 * Use case principal : dupliquer une semaine type.
 */
export const mealPlanRangesRouter = new Hono<{ Bindings: Bindings }>();

mealPlanRangesRouter.use('*', requireAuth());

type Row = {
  id: string;
  household_id: string;
  name: string;
  date_from: string;
  date_to: string;
  created_at: string;
  updated_at: string;
};

function mapRow(r: Row): MealPlanRange {
  return {
    id: r.id,
    householdId: r.household_id,
    name: r.name,
    dateFrom: r.date_from,
    dateTo: r.date_to,
    createdAt: toIsoString(r.created_at),
    updatedAt: toIsoString(r.updated_at),
  };
}

// ============================================================================
// GET /api/households/:hid/meal-plan-ranges
// Liste les plages d'un foyer (eventuellement filtrees par fenetre).
// ============================================================================
mealPlanRangesRouter.get('/households/:householdId/meal-plan-ranges', async (c) => {
  const auth = getAuth(c);
  const householdId = c.req.param('householdId');
  if (!householdId) return c.json({ error: 'missing_household_id' }, 400);

  const sb = getUserClient(c.env, auth.accessToken);
  let query = sb
    .from('meal_plan_ranges')
    .select('*')
    .eq('household_id', householdId)
    .order('date_from', { ascending: true });

  // Optionnel : filtrer les plages qui chevauchent une fenetre [from, to]
  // pour limiter la charge sur la vue calendrier.
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (from && to) {
    // chevauchement = NOT (date_to < from OR date_from > to)
    query = query.or(`and(date_to.gte.${from},date_from.lte.${to})`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[mpr] list failed', error);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json({ items: ((data ?? []) as unknown as Row[]).map(mapRow) });
});

// ============================================================================
// POST /api/meal-plan-ranges (body: CreateMealPlanRangeInput)
// Cree une nouvelle plage.
// ============================================================================
mealPlanRangesRouter.post('/meal-plan-ranges', async (c) => {
  const auth = getAuth(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = CreateMealPlanRangeInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;
  const sb = getUserClient(c.env, auth.accessToken);

  const { data, error } = await sb.rpc('create_meal_plan_range', {
    p_household_id: input.householdId,
    p_name: input.name,
    p_date_from: input.dateFrom,
    p_date_to: input.dateTo,
  });

  if (error) {
    console.error('[mpr] create failed', error);
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    if (error.code === '22023')
      return c.json({ error: 'invalid_range', message: error.message }, 400);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json(mapRow(data as unknown as Row), 201);
});

// ============================================================================
// PATCH /api/meal-plan-ranges/:id
// Renomme ou redimensionne une plage existante.
// ============================================================================
mealPlanRangesRouter.patch('/meal-plan-ranges/:id', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = UpdateMealPlanRangeInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.dateFrom !== undefined) patch.dateFrom = parsed.data.dateFrom;
  if (parsed.data.dateTo !== undefined) patch.dateTo = parsed.data.dateTo;

  const sb = getUserClient(c.env, auth.accessToken);
  const { data, error } = await sb.rpc('update_meal_plan_range', {
    p_range_id: id,
    p_patch: patch,
  });
  if (error) {
    console.error('[mpr] update failed', error);
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    if (error.code === 'P0002') return c.json({ error: 'not_found' }, 404);
    if (error.code === '22023')
      return c.json({ error: 'invalid_range', message: error.message }, 400);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json(mapRow(data as unknown as Row));
});

// ============================================================================
// DELETE /api/meal-plan-ranges/:id
// ============================================================================
mealPlanRangesRouter.delete('/meal-plan-ranges/:id', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);

  const sb = getUserClient(c.env, auth.accessToken);
  const { error } = await sb.rpc('delete_meal_plan_range', { p_range_id: id });
  if (error) {
    console.error('[mpr] delete failed', error);
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    if (error.code === 'P0002') return c.json({ error: 'not_found' }, 404);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json({ ok: true });
});

// ============================================================================
// POST /api/meal-plan-ranges/duplicate
// Duplique tous les meals d'une fenetre source vers une cible (offset =
// targetStart - sourceFrom). Cree optionnellement une nouvelle plage nommee.
// ============================================================================
mealPlanRangesRouter.post('/meal-plan-ranges/duplicate', async (c) => {
  const auth = getAuth(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = DuplicateMealsRangeInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;
  const sb = getUserClient(c.env, auth.accessToken);

  const { data, error } = await sb.rpc('duplicate_meals_range', {
    p_household_id: input.householdId,
    p_source_from: input.sourceFrom,
    p_source_to: input.sourceTo,
    p_target_start: input.targetStart,
    p_create_range_name: input.createRangeName ?? null,
  });
  if (error) {
    console.error('[mpr] duplicate failed', error);
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    if (error.code === '22023')
      return c.json({ error: 'invalid_range', message: error.message }, 400);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  const result = data as unknown as {
    inserted: number;
    targetFrom: string;
    targetTo: string;
    rangeId: string | null;
  };
  const payload: DuplicateMealsRangeResponse = {
    inserted: result.inserted,
    targetFrom: result.targetFrom,
    targetTo: result.targetTo,
    rangeId: result.rangeId,
  };
  return c.json(payload);
});
