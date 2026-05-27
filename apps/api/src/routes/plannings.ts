import {
  type MealPlan,
  type MealsRange,
  type PlannedMeal,
  SetMealsRangeInputSchema,
  type ShoppingItem,
  type ShoppingListResponse,
  UpdatePlannedMealInputSchema,
  UpsertMealPlanInputSchema,
} from '@mealendar/shared';
import { Hono } from 'hono';
import type { Bindings } from '../index';
import { toIsoString } from '../lib/dates';
import { type IcsEvent, buildIcs } from '../lib/ics';
import { getUserClient } from '../lib/supabase';
import { getAuth, requireAuth } from '../middleware/auth';

/**
 * Routes "planning" version calendrier libre.
 *
 * Plus d'entite "planning" : les meals sont rattaches directement au foyer
 * (planned_meals.household_id) + une date. Le client demande un range
 * arbitraire [from, to] pour afficher / generer / shopper / exporter.
 */
export const planningsRouter = new Hono<{ Bindings: Bindings }>();

planningsRouter.use('*', requireAuth());

// ============================================================================
// Helpers de mapping
// ============================================================================

type MealPlanRow = {
  id: string;
  household_id: string;
  name: string;
  is_default: boolean;
  slot_config: Record<string, { key: string; time?: string }[]> | null;
  nutrition_targets: unknown;
  variety_rules: unknown;
  diet_plan: unknown;
  created_at: string;
  updated_at: string;
};

type PlannedMealRow = {
  id: string;
  household_id: string;
  date: string;
  slot_key: string;
  recipe_id: string | null;
  custom_title: string | null;
  servings: number;
  diners: string[];
  locked: boolean;
  notes: string | null;
  position: number;
  covers_meals: number;
};

function mapMealPlan(row: MealPlanRow): MealPlan {
  return {
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    isDefault: row.is_default,
    slotConfig: (row.slot_config ?? {}) as MealPlan['slotConfig'],
    nutritionTargets: (row.nutrition_targets ?? null) as MealPlan['nutritionTargets'],
    varietyRules: (row.variety_rules ?? null) as MealPlan['varietyRules'],
    dietPlan: (row.diet_plan ?? null) as MealPlan['dietPlan'],
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapPlannedMeal(row: PlannedMealRow): PlannedMeal {
  return {
    id: row.id,
    householdId: row.household_id,
    date: row.date,
    slotKey: row.slot_key,
    recipeId: row.recipe_id,
    customTitle: row.custom_title,
    servings: row.servings,
    diners: row.diners ?? [],
    locked: row.locked,
    notes: row.notes,
    position: row.position,
    coversMeals: row.covers_meals ?? 1,
  };
}

// ============================================================================
// Validation des query strings ?from=YYYY-MM-DD&to=YYYY-MM-DD
// ============================================================================
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseRange(c: { req: { query: (k: string) => string | undefined } }) {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return { error: 'invalid_range' as const };
  }
  if (to < from) return { error: 'invalid_range' as const };
  return { from, to };
}

// ============================================================================
// Plan-type (inchange par la refonte calendrier)
// ============================================================================

planningsRouter.get('/households/:householdId/meal-plan', async (c) => {
  const auth = getAuth(c);
  const householdId = c.req.param('householdId');
  if (!householdId) return c.json({ error: 'missing_household_id' }, 400);

  const sb = getUserClient(c.env, auth.accessToken);

  const { data, error } = await sb
    .from('meal_plans')
    .select('*')
    .eq('household_id', householdId)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[planning] meal-plan get failed', error);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  if (!data) return c.json({ mealPlan: null });

  return c.json({ mealPlan: mapMealPlan(data as unknown as MealPlanRow) });
});

planningsRouter.put('/meal-plan', async (c) => {
  const auth = getAuth(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = UpsertMealPlanInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;

  const sb = getUserClient(c.env, auth.accessToken);
  const { data, error } = await sb.rpc('upsert_meal_plan', {
    p_household_id: input.householdId,
    p_name: input.name,
    p_slot_config: input.slotConfig,
    p_nutrition_targets: input.nutritionTargets ?? null,
    p_variety_rules: input.varietyRules ?? null,
    p_diet_plan: input.dietPlan ?? null,
    p_meal_plan_id: input.mealPlanId ?? null,
  });

  if (error) {
    console.error('[planning] upsert_meal_plan RPC failed', error);
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    if (error.code === 'P0002') return c.json({ error: 'not_found' }, 404);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json({ mealPlan: mapMealPlan(data as unknown as MealPlanRow) });
});

// ============================================================================
// GET /api/households/:hid/meals?from=&to=
//
// Retourne tous les meals du foyer dans la fenetre [from, to] inclusive.
// ============================================================================
planningsRouter.get('/households/:householdId/meals', async (c) => {
  const auth = getAuth(c);
  const householdId = c.req.param('householdId');
  if (!householdId) return c.json({ error: 'missing_household_id' }, 400);

  const range = parseRange(c);
  if ('error' in range) return c.json({ error: range.error }, 400);

  const sb = getUserClient(c.env, auth.accessToken);
  const { data, error } = await sb
    .from('planned_meals')
    .select('*')
    .eq('household_id', householdId)
    .gte('date', range.from)
    .lte('date', range.to)
    .order('date', { ascending: true })
    .order('position', { ascending: true });

  if (error) {
    console.error('[planning] meals fetch failed', error);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }

  const meals = (data as unknown as PlannedMealRow[]).map(mapPlannedMeal);
  const payload: MealsRange = {
    householdId,
    dateFrom: range.from,
    dateTo: range.to,
    meals,
  };
  return c.json(payload);
});

// ============================================================================
// PUT /api/households/:hid/meals  (body: SetMealsRangeInput)
//
// Replace tous les meals du foyer dans [dateFrom, dateTo] par la liste fournie
// (en preservant les locked si keepLocked=true).
// ============================================================================
planningsRouter.put('/households/:householdId/meals', async (c) => {
  const auth = getAuth(c);
  const householdId = c.req.param('householdId');
  if (!householdId) return c.json({ error: 'missing_household_id' }, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = SetMealsRangeInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }

  const sb = getUserClient(c.env, auth.accessToken);
  const { data, error } = await sb.rpc('set_meals_for_range', {
    p_household_id: householdId,
    p_date_from: parsed.data.dateFrom,
    p_date_to: parsed.data.dateTo,
    p_meals: parsed.data.meals.map((m) => ({
      date: m.date,
      slotKey: m.slotKey,
      recipeId: m.recipeId ?? null,
      customTitle: m.customTitle ?? null,
      servings: m.servings,
      diners: m.diners,
      locked: m.locked,
      notes: m.notes ?? null,
      position: m.position,
      coversMeals: m.coversMeals,
    })),
    p_keep_locked: parsed.data.keepLocked,
  });

  if (error) {
    console.error('[planning] set_meals_for_range RPC failed', error);
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    if (error.code === '22023')
      return c.json({ error: 'invalid_range', message: error.message }, 400);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  const result = data as unknown as {
    householdId: string;
    dateFrom: string;
    dateTo: string;
    meals: PlannedMealRow[];
  };
  const payload: MealsRange = {
    householdId: result.householdId,
    dateFrom: result.dateFrom,
    dateTo: result.dateTo,
    meals: (result.meals ?? []).map(mapPlannedMeal),
  };
  return c.json(payload);
});

// ============================================================================
// PATCH /api/planned-meals/:id   (edit unitaire)
// ============================================================================
planningsRouter.patch('/planned-meals/:id', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = UpdatePlannedMealInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }

  const sb = getUserClient(c.env, auth.accessToken);
  const patchObj: Record<string, unknown> = {};
  if (parsed.data.recipeId !== undefined) patchObj.recipeId = parsed.data.recipeId ?? null;
  if (parsed.data.customTitle !== undefined) patchObj.customTitle = parsed.data.customTitle;
  if (parsed.data.servings !== undefined) patchObj.servings = parsed.data.servings;
  if (parsed.data.diners !== undefined) patchObj.diners = parsed.data.diners;
  if (parsed.data.locked !== undefined) patchObj.locked = parsed.data.locked;
  if (parsed.data.notes !== undefined) patchObj.notes = parsed.data.notes;
  if (parsed.data.coversMeals !== undefined) patchObj.coversMeals = parsed.data.coversMeals;

  const { data, error } = await sb.rpc('update_planned_meal', {
    p_meal_id: id,
    p_patch: patchObj,
  });

  if (error) {
    console.error('[planning] update_planned_meal RPC failed', error);
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    if (error.code === 'P0002') return c.json({ error: 'not_found' }, 404);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json(mapPlannedMeal(data as unknown as PlannedMealRow));
});

// ============================================================================
// DELETE /api/planned-meals/:id  (suppression unitaire)
// ============================================================================
planningsRouter.delete('/planned-meals/:id', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);

  const sb = getUserClient(c.env, auth.accessToken);
  const { error } = await sb.rpc('delete_planned_meal', { p_meal_id: id });

  if (error) {
    console.error('[planning] delete_planned_meal RPC failed', error);
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    if (error.code === 'P0002') return c.json({ error: 'not_found' }, 404);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json({ ok: true });
});

// ============================================================================
// Liste de courses : agregation des recipe_ingredients sur une fenetre
// GET /api/households/:hid/shopping-list?from=&to=
// ============================================================================
planningsRouter.get('/households/:householdId/shopping-list', async (c) => {
  const auth = getAuth(c);
  const householdId = c.req.param('householdId');
  if (!householdId) return c.json({ error: 'missing_household_id' }, 400);

  const range = parseRange(c);
  if ('error' in range) return c.json({ error: range.error }, 400);

  const sb = getUserClient(c.env, auth.accessToken);

  // 1. recupere les meals du foyer dans la fenetre
  const { data: meals, error: mErr } = await sb
    .from('planned_meals')
    .select('recipe_id, servings')
    .eq('household_id', householdId)
    .gte('date', range.from)
    .lte('date', range.to)
    .not('recipe_id', 'is', null);
  if (mErr) {
    console.error('[shopping] meals fetch failed', mErr);
    return c.json({ error: 'db_error', message: mErr.message }, 500);
  }

  type MealMini = { recipe_id: string; servings: number };
  const mealsList = (meals ?? []) as unknown as MealMini[];

  if (mealsList.length === 0) {
    const empty: ShoppingListResponse = {
      householdId,
      dateFrom: range.from,
      dateTo: range.to,
      items: [],
    };
    return c.json(empty);
  }

  const recipeIds = [...new Set(mealsList.map((m) => m.recipe_id))];

  // 2. recipes (servings de reference)
  const { data: recipes, error: rErr } = await sb
    .from('recipes')
    .select('id, servings')
    .in('id', recipeIds);
  if (rErr) {
    console.error('[shopping] recipes fetch failed', rErr);
    return c.json({ error: 'db_error', message: rErr.message }, 500);
  }
  type RecipeMini = { id: string; servings: number };
  const recipeServings = new Map<string, number>(
    (recipes as unknown as RecipeMini[]).map((r) => [r.id, r.servings]),
  );

  // 3. ingredients
  const { data: ings, error: iErr } = await sb
    .from('recipe_ingredients')
    .select('recipe_id, ingredient_name, quantity, unit')
    .in('recipe_id', recipeIds);
  if (iErr) {
    console.error('[shopping] ingredients fetch failed', iErr);
    return c.json({ error: 'db_error', message: iErr.message }, 500);
  }
  type IngMini = {
    recipe_id: string;
    ingredient_name: string;
    quantity: number | null;
    unit: string | null;
  };

  // 4. agrege par (name normalise, unit) avec ratio servings
  type Key = string;
  const norm = (s: string) => s.trim().toLowerCase();
  const keyFor = (name: string, unit: string | null) => `${norm(name)}|${unit ?? ''}`;
  const acc = new Map<
    Key,
    {
      ingredientName: string;
      unit: string | null;
      totalQuantity: number | null;
      recipeIds: Set<string>;
    }
  >();

  for (const ing of (ings ?? []) as unknown as IngMini[]) {
    const baseServings = recipeServings.get(ing.recipe_id) ?? 1;
    const mealsForRecipe = mealsList.filter((m) => m.recipe_id === ing.recipe_id);
    const k = keyFor(ing.ingredient_name, ing.unit);
    const existing = acc.get(k) ?? {
      ingredientName: ing.ingredient_name,
      unit: ing.unit,
      totalQuantity: ing.quantity == null ? null : 0,
      recipeIds: new Set<string>(),
    };
    existing.recipeIds.add(ing.recipe_id);
    if (ing.quantity != null && existing.totalQuantity != null) {
      let sum = 0;
      for (const m of mealsForRecipe) {
        const ratio = m.servings / Math.max(baseServings, 1);
        sum += ing.quantity * ratio;
      }
      existing.totalQuantity += sum;
    } else {
      existing.totalQuantity = null;
    }
    acc.set(k, existing);
  }

  const items: ShoppingItem[] = Array.from(acc.values())
    .map((it) => ({
      ingredientName: it.ingredientName,
      unit: it.unit,
      totalQuantity: it.totalQuantity == null ? null : Math.round(it.totalQuantity * 100) / 100,
      recipeIds: Array.from(it.recipeIds),
    }))
    .sort((a, b) => a.ingredientName.localeCompare(b.ingredientName));

  const payload: ShoppingListResponse = {
    householdId,
    dateFrom: range.from,
    dateTo: range.to,
    items,
  };
  return c.json(payload);
});

// ============================================================================
// GET /api/households/:hid/ics?from=&to=
// Exporte les meals de la fenetre au format iCalendar.
// ============================================================================
planningsRouter.get('/households/:householdId/ics', async (c) => {
  const auth = getAuth(c);
  const householdId = c.req.param('householdId');
  if (!householdId) return c.json({ error: 'missing_household_id' }, 400);

  const range = parseRange(c);
  if ('error' in range) return c.json({ error: range.error }, 400);

  const sb = getUserClient(c.env, auth.accessToken);

  const { data: household, error: hErr } = await sb
    .from('households')
    .select('id, name')
    .eq('id', householdId)
    .maybeSingle();
  if (hErr || !household) {
    return c.json({ error: 'not_found' }, 404);
  }

  const { data: meals, error: mErr } = await sb
    .from('planned_meals')
    .select('id, date, slot_key, recipe_id, custom_title')
    .eq('household_id', householdId)
    .gte('date', range.from)
    .lte('date', range.to)
    .order('date', { ascending: true })
    .order('position', { ascending: true });
  if (mErr) {
    return c.json({ error: 'db_error', message: mErr.message }, 500);
  }

  type MealMini = {
    id: string;
    date: string;
    slot_key: string;
    recipe_id: string | null;
    custom_title: string | null;
  };
  const mealsList = (meals ?? []) as unknown as MealMini[];

  const recipeIds = [...new Set(mealsList.map((m) => m.recipe_id).filter((x): x is string => !!x))];
  const titles = new Map<string, string>();
  if (recipeIds.length > 0) {
    const { data: recipes } = await sb.from('recipes').select('id, title').in('id', recipeIds);
    for (const r of (recipes ?? []) as unknown as { id: string; title: string }[]) {
      titles.set(r.id, r.title);
    }
  }

  const events: IcsEvent[] = mealsList
    .map((m) => {
      const title = m.recipe_id
        ? (titles.get(m.recipe_id) ?? m.custom_title ?? 'Repas')
        : (m.custom_title ?? 'Repas');
      return {
        uid: m.id,
        date: m.date,
        slotKey: m.slot_key,
        title,
      };
    })
    .filter((e) => e.title.trim().length > 0);

  const ics = buildIcs({
    calendarName: `Mealendar - ${(household as { name: string }).name}`,
    events,
  });

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="mealendar-${range.from}_${range.to}.ics"`,
    },
  });
});
