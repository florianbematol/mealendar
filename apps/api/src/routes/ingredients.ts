import {
  type BarcodeLookupResponse,
  type Ingredient,
  type SearchIngredientsResponse,
  UpsertIngredientInputSchema,
} from '@mealendar/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings } from '../index';
import { toIsoString } from '../lib/dates';
import { fetchByBarcode, searchOff } from '../lib/openFoodFacts';
import { getUserClient } from '../lib/supabase';
import { getAuth, requireAuth } from '../middleware/auth';

export const ingredientsRouter = new Hono<{ Bindings: Bindings }>();

ingredientsRouter.use('*', requireAuth());

// ============================================================================
// Mapping DB row -> shape API
// ============================================================================
type IngredientRow = {
  id: string;
  household_id: string | null;
  name: string;
  off_barcode: string | null;
  default_unit: string;
  kcal_100g: number | null;
  protein_100g: number | null;
  carbs_100g: number | null;
  fat_100g: number | null;
  fiber_100g: number | null;
  category: string | null;
  allergens: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function mapIngredient(row: IngredientRow): Ingredient {
  return {
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    offBarcode: row.off_barcode,
    defaultUnit: row.default_unit,
    kcal100g: row.kcal_100g,
    protein100g: row.protein_100g,
    carbs100g: row.carbs_100g,
    fat100g: row.fat_100g,
    fiber100g: row.fiber_100g,
    category: row.category,
    allergens: row.allergens ?? [],
    createdBy: row.created_by,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

// ============================================================================
// GET /api/ingredients/search?householdId=...&q=...&limit=20
// Recherche dans la base locale (foyer + globaux Open Food Facts deja en cache).
// ============================================================================
const SearchQuerySchema = z.object({
  householdId: z.string().uuid(),
  q: z.string().default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

ingredientsRouter.get('/ingredients/search', async (c) => {
  const auth = getAuth(c);
  const parsed = SearchQuerySchema.safeParse({
    householdId: c.req.query('householdId'),
    q: c.req.query('q') ?? '',
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const sb = getUserClient(c.env, auth.accessToken);
  const { data, error } = await sb.rpc('search_ingredients', {
    p_household_id: parsed.data.householdId,
    p_query: parsed.data.q,
    p_limit: parsed.data.limit,
  });

  if (error) {
    console.error('[ingredients] search RPC failed', error);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  const items = (data as unknown as IngredientRow[]).map(mapIngredient);
  const payload: SearchIngredientsResponse = { items };
  return c.json(payload);
});

// ============================================================================
// GET /api/ingredients/barcode/:ean
// Lookup local d'abord (cache global household_id=null), fallback Open Food Facts.
// Si OFF retourne un produit, on cache en DB (ingredient global).
// ============================================================================
ingredientsRouter.get('/ingredients/barcode/:ean', async (c) => {
  const auth = getAuth(c);
  const ean = c.req.param('ean');
  if (!ean || !/^[0-9]{6,20}$/.test(ean)) {
    return c.json({ error: 'invalid_barcode' }, 400);
  }

  const sb = getUserClient(c.env, auth.accessToken);

  // Lookup en DB (cache global ou ingredient deja importe)
  const { data: existing, error: existErr } = await sb
    .from('ingredients')
    .select(
      `id, household_id, name, off_barcode, default_unit,
       kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g,
       category, allergens, created_by, created_at, updated_at`,
    )
    .eq('off_barcode', ean)
    .is('household_id', null)
    .maybeSingle();

  if (existErr) {
    console.error('[ingredients] barcode lookup DB failed', existErr);
  }
  if (existing) {
    const payload: BarcodeLookupResponse = {
      found: true,
      product: null,
      ingredient: mapIngredient(existing as unknown as IngredientRow),
    };
    return c.json(payload);
  }

  // Fallback Open Food Facts
  const product = await fetchByBarcode(ean, c.env.CACHE);
  if (!product) {
    const payload: BarcodeLookupResponse = {
      found: false,
      product: null,
      ingredient: null,
    };
    return c.json(payload);
  }

  // Cache en DB (ingredient global) via RPC upsert_ingredient
  const { data: inserted, error: insertErr } = await sb.rpc('upsert_ingredient', {
    p_household_id: null,
    p_payload: {
      name: product.name,
      offBarcode: product.barcode,
      defaultUnit: product.defaultUnit,
      kcal100g: product.kcal100g,
      protein100g: product.protein100g,
      carbs100g: product.carbs100g,
      fat100g: product.fat100g,
      fiber100g: product.fiber100g,
      category: product.category,
      allergens: product.allergens,
    },
  });

  if (insertErr) {
    console.warn('[ingredients] cache insert failed', insertErr);
  }

  const payload: BarcodeLookupResponse = {
    found: true,
    product,
    ingredient: inserted ? mapIngredient(inserted as unknown as IngredientRow) : null,
  };
  return c.json(payload);
});

// ============================================================================
// GET /api/ingredients/off-search?q=... : recherche directe Open Food Facts
// ============================================================================
ingredientsRouter.get('/ingredients/off-search', async (c) => {
  const q = c.req.query('q') ?? '';
  const limitRaw = c.req.query('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 10;
  if (q.trim().length < 2) {
    return c.json({ items: [] });
  }
  const items = await searchOff(q, Number.isFinite(limit) ? limit : 10, c.env.CACHE);
  return c.json({ items });
});

// ============================================================================
// GET /api/ingredients/by-ids?ids=uuid,uuid,...
// Batch fetch d'ingredients par leurs IDs (pour calcul des macros).
// ============================================================================
ingredientsRouter.get('/ingredients/by-ids', async (c) => {
  const auth = getAuth(c);
  const idsRaw = c.req.query('ids') ?? '';
  const ids = idsRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  if (ids.length === 0) {
    return c.json({ items: [] });
  }
  const sb = getUserClient(c.env, auth.accessToken);
  const { data, error } = await sb
    .from('ingredients')
    .select(
      `id, household_id, name, off_barcode, default_unit,
       kcal_100g, protein_100g, carbs_100g, fat_100g, fiber_100g,
       category, allergens, created_by, created_at, updated_at`,
    )
    .in('id', ids);

  if (error) {
    console.error('[ingredients] by-ids failed', error);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  const items = (data as unknown as IngredientRow[]).map(mapIngredient);
  return c.json({ items });
});

// ============================================================================
// POST /api/ingredients : upsert custom ingredient (foyer)
// ============================================================================
ingredientsRouter.post('/ingredients', async (c) => {
  const auth = getAuth(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = UpsertIngredientInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;
  const sb = getUserClient(c.env, auth.accessToken);

  const { data, error } = await sb.rpc('upsert_ingredient', {
    p_household_id: input.householdId,
    p_payload: {
      name: input.name,
      offBarcode: input.offBarcode ?? null,
      defaultUnit: input.defaultUnit,
      kcal100g: input.kcal100g ?? null,
      protein100g: input.protein100g ?? null,
      carbs100g: input.carbs100g ?? null,
      fat100g: input.fat100g ?? null,
      fiber100g: input.fiber100g ?? null,
      category: input.category ?? null,
      allergens: input.allergens,
    },
  });

  if (error) {
    console.error('[ingredients] upsert RPC failed', error);
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json(mapIngredient(data as unknown as IngredientRow), 201);
});
