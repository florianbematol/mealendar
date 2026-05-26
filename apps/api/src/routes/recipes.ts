import {
  type CreateRecipeInput,
  CreateRecipeInputSchema,
  type ImportRecipeInput,
  ImportRecipeInputSchema,
  type ImportRecipeResponse,
  type ListRecipesResponse,
  type Recipe,
  type RecipeIngredient,
  type RecipeListItem,
  type RecipePhotoUploadInput,
  RecipePhotoUploadInputSchema,
  type RecipePhotoUploadResponse,
  type RecipeWithIngredients,
  type UpdateRecipeInput,
  UpdateRecipeInputSchema,
} from '@mealendar/shared';
import { Hono } from 'hono';
import type { Bindings } from '../index';
import { toIsoString } from '../lib/dates';
import { importRecipeFromUrl } from '../lib/recipeImporter';
import { parseSteps } from '../lib/recipeSteps';
import { getServiceClient, getUserClient } from '../lib/supabase';
import { getAuth, requireAuth } from '../middleware/auth';

export const recipesRouter = new Hono<{ Bindings: Bindings }>();

recipesRouter.use('*', requireAuth());

// ============================================================================
// Helpers de mapping DB row -> shape API
// ============================================================================

type RecipeRow = {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  servings: number;
  prep_time_min: number | null;
  cook_time_min: number | null;
  steps: unknown;
  source: 'user' | 'llm' | 'api';
  source_ref: string | null;
  image_url: string | null;
  diet_tags: string[];
  meal_slots: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type RecipeIngredientRow = {
  id: string;
  recipe_id: string;
  ingredient_id: string | null;
  ingredient_name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  position: number;
};

/**
 * Parse le champ jsonb `steps` issu de la DB en RecipeStep[] valide.
 * Implementation : lib/recipeSteps.ts
 */

function mapRecipe(row: RecipeRow): Recipe {
  return {
    id: row.id,
    householdId: row.household_id,
    title: row.title,
    description: row.description,
    servings: row.servings,
    prepTimeMin: row.prep_time_min,
    cookTimeMin: row.cook_time_min,
    steps: parseSteps(row.steps),
    source: row.source,
    sourceRef: row.source_ref,
    imageUrl: row.image_url,
    dietTags: row.diet_tags ?? [],
    mealSlots: row.meal_slots ?? [],
    createdBy: row.created_by,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapRecipeIngredient(row: RecipeIngredientRow): RecipeIngredient {
  return {
    ingredientId: row.ingredient_id,
    ingredientName: row.ingredient_name,
    quantity: row.quantity,
    unit: row.unit,
    notes: row.notes,
    position: row.position,
  };
}

// ============================================================================
// GET /api/households/:householdId/recipes
// ============================================================================
recipesRouter.get('/households/:householdId/recipes', async (c) => {
  const auth = getAuth(c);
  const householdId = c.req.param('householdId');
  if (!householdId) return c.json({ error: 'missing_household_id' }, 400);

  const sb = getUserClient(c.env, auth.accessToken);

  const { data, error } = await sb
    .from('recipes')
    .select(
      `id, household_id, title, description, servings, prep_time_min, cook_time_min,
       image_url, source, diet_tags, meal_slots, updated_at,
       recipe_ingredients (id)`,
    )
    .eq('household_id', householdId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[recipes] list failed', error);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }

  type RowWithIngs = RecipeRow & { recipe_ingredients: { id: string }[] | null };
  const rows = data as unknown as RowWithIngs[];

  // Charge les favoris du user (sur ce sous-ensemble) pour marquer chaque ligne
  const ids = rows.map((r) => r.id);
  let favSet = new Set<string>();
  if (ids.length > 0) {
    const { data: favs } = await sb
      .from('recipe_favorites')
      .select('recipe_id')
      .eq('user_id', auth.userId)
      .in('recipe_id', ids);
    if (favs) {
      favSet = new Set((favs as { recipe_id: string }[]).map((f) => f.recipe_id));
    }
  }

  const items: RecipeListItem[] = rows.map((r) => ({
    id: r.id,
    householdId: r.household_id,
    title: r.title,
    description: r.description,
    servings: r.servings,
    prepTimeMin: r.prep_time_min,
    cookTimeMin: r.cook_time_min,
    imageUrl: r.image_url,
    source: r.source,
    dietTags: r.diet_tags ?? [],
    mealSlots: r.meal_slots ?? [],
    ingredientCount: r.recipe_ingredients?.length ?? 0,
    updatedAt: toIsoString(r.updated_at),
    isFavorite: favSet.has(r.id),
  }));

  const payload: ListRecipesResponse = { items };
  return c.json(payload);
});

// ============================================================================
// GET /api/recipes/:id
// ============================================================================
recipesRouter.get('/recipes/:id', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);

  const sb = getUserClient(c.env, auth.accessToken);

  const { data: recipeRow, error: recipeErr } = await sb
    .from('recipes')
    .select(
      `id, household_id, title, description, servings, prep_time_min, cook_time_min,
       steps, source, source_ref, image_url, diet_tags, meal_slots,
       created_by, created_at, updated_at`,
    )
    .eq('id', id)
    .maybeSingle();

  if (recipeErr) {
    console.error('[recipes] get failed', recipeErr);
    return c.json({ error: 'db_error', message: recipeErr.message }, 500);
  }
  if (!recipeRow) return c.json({ error: 'not_found' }, 404);

  const { data: ingRows, error: ingErr } = await sb
    .from('recipe_ingredients')
    .select('id, recipe_id, ingredient_id, ingredient_name, quantity, unit, notes, position')
    .eq('recipe_id', id)
    .order('position', { ascending: true });

  if (ingErr) {
    console.error('[recipes] ingredients fetch failed', ingErr);
    return c.json({ error: 'db_error', message: ingErr.message }, 500);
  }

  const { data: fav } = await sb
    .from('recipe_favorites')
    .select('recipe_id')
    .eq('recipe_id', id)
    .eq('user_id', auth.userId)
    .maybeSingle();

  const recipe = mapRecipe(recipeRow as unknown as RecipeRow);
  const ingredients = (ingRows as unknown as RecipeIngredientRow[]).map(mapRecipeIngredient);

  const payload: RecipeWithIngredients = { ...recipe, ingredients, isFavorite: !!fav };
  return c.json(payload);
});

// ============================================================================
// POST /api/recipes  (cree une recette + ingredients via RPC create_recipe)
// ============================================================================
recipesRouter.post('/recipes', async (c) => {
  const auth = getAuth(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = CreateRecipeInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;

  const sb = getUserClient(c.env, auth.accessToken);

  const { data, error } = await sb.rpc('create_recipe', {
    p_household_id: input.householdId,
    p_recipe: {
      title: input.title,
      description: input.description ?? null,
      servings: input.servings,
      prepTimeMin: input.prepTimeMin ?? null,
      cookTimeMin: input.cookTimeMin ?? null,
      steps: input.steps,
      imageUrl: input.imageUrl ?? null,
      dietTags: input.dietTags,
      mealSlots: input.mealSlots,
      source: 'user',
    },
    p_ingredients: input.ingredients.map((i) => ({
      ingredientId: i.ingredientId ?? null,
      name: i.name,
      quantity: i.quantity ?? null,
      unit: i.unit ?? null,
      notes: i.notes ?? null,
    })),
  });

  if (error) {
    console.error('[recipes] create_recipe RPC failed', error);
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }

  const result = data as unknown as { recipe: RecipeRow; ingredients: RecipeIngredientRow[] };
  const recipe = mapRecipe(result.recipe);
  const ingredients = (result.ingredients ?? []).map(mapRecipeIngredient);
  const payload: RecipeWithIngredients = { ...recipe, ingredients, isFavorite: false };
  return c.json(payload, 201);
});

// ============================================================================
// PATCH /api/recipes/:id
// ============================================================================
recipesRouter.patch('/recipes/:id', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = UpdateRecipeInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;

  const sb = getUserClient(c.env, auth.accessToken);

  const { data, error } = await sb.rpc('update_recipe', {
    p_recipe_id: id,
    p_recipe: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.servings !== undefined ? { servings: input.servings } : {}),
      ...(input.prepTimeMin !== undefined ? { prepTimeMin: input.prepTimeMin } : {}),
      ...(input.cookTimeMin !== undefined ? { cookTimeMin: input.cookTimeMin } : {}),
      ...(input.steps !== undefined ? { steps: input.steps } : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
      ...(input.dietTags !== undefined ? { dietTags: input.dietTags } : {}),
      ...(input.mealSlots !== undefined ? { mealSlots: input.mealSlots } : {}),
    },
    p_ingredients:
      input.ingredients !== undefined
        ? input.ingredients.map((i) => ({
            ingredientId: i.ingredientId ?? null,
            name: i.name,
            quantity: i.quantity ?? null,
            unit: i.unit ?? null,
            notes: i.notes ?? null,
          }))
        : null,
  });

  if (error) {
    console.error('[recipes] update_recipe RPC failed', error);
    if (error.code === 'P0002') return c.json({ error: 'not_found' }, 404);
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }

  const result = data as unknown as { recipe: RecipeRow; ingredients: RecipeIngredientRow[] };
  const recipe = mapRecipe(result.recipe);
  const ingredients = (result.ingredients ?? []).map(mapRecipeIngredient);

  // Conserve le statut favori courant (le PATCH ne le modifie pas)
  const sb2 = getUserClient(c.env, auth.accessToken);
  const { data: fav } = await sb2
    .from('recipe_favorites')
    .select('recipe_id')
    .eq('recipe_id', id)
    .eq('user_id', auth.userId)
    .maybeSingle();

  const payload: RecipeWithIngredients = { ...recipe, ingredients, isFavorite: !!fav };
  return c.json(payload);
});

// ============================================================================
// DELETE /api/recipes/:id
// ============================================================================
recipesRouter.delete('/recipes/:id', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);

  const sb = getUserClient(c.env, auth.accessToken);

  const { error } = await sb.rpc('delete_recipe', { p_recipe_id: id });

  if (error) {
    console.error('[recipes] delete_recipe RPC failed', error);
    if (error.code === 'P0002') return c.json({ error: 'not_found' }, 404);
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json({ ok: true });
});

// ============================================================================
// POST /api/recipes/:id/favorite : toggle favori (insert si absent, delete sinon)
// ============================================================================
recipesRouter.post('/recipes/:id/favorite', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);

  const sb = getUserClient(c.env, auth.accessToken);
  const { data, error } = await sb.rpc('toggle_recipe_favorite', { p_recipe_id: id });
  if (error) {
    console.error('[recipes] toggle_favorite failed', error);
    if (error.code === 'P0002') return c.json({ error: 'not_found' }, 404);
    if (error.code === '42501') return c.json({ error: 'forbidden' }, 403);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json({ isFavorite: data === true });
});

// ============================================================================
// POST /api/recipes/:id/photo-upload-url : signed upload URL pour Storage
// Le client poste ensuite directement vers Supabase Storage avec cette URL.
// ============================================================================
recipesRouter.post('/recipes/:id/photo-upload-url', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = RecipePhotoUploadInputSchema.safeParse({ ...(body as object), recipeId: id });
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }

  const sb = getUserClient(c.env, auth.accessToken);

  // Verifie que la recette existe et que l'user est membre du foyer
  const { data: recipe, error: rErr } = await sb
    .from('recipes')
    .select('id, household_id')
    .eq('id', id)
    .maybeSingle();
  if (rErr) {
    console.error('[recipes] photo-upload-url recipe lookup failed', rErr);
    return c.json({ error: 'db_error', message: rErr.message }, 500);
  }
  if (!recipe) return c.json({ error: 'not_found' }, 404);
  const householdId = (recipe as { household_id: string }).household_id;

  // Chemin : <household>/<recipe>/<timestamp>.<ext>
  const path = `${householdId}/${id}/${Date.now()}.${parsed.data.ext}`;

  // Storage createSignedUploadUrl utilise le service role (bypass RLS pour la signature).
  // Le upload final sera quand meme verifie par les RLS du bucket via le user JWT.
  const service = getServiceClient(c.env);
  const { data: signed, error: signErr } = await service.storage
    .from('recipe-images')
    .createSignedUploadUrl(path);

  if (signErr || !signed) {
    console.error('[recipes] createSignedUploadUrl failed', signErr);
    return c.json({ error: 'storage_error', message: signErr?.message }, 500);
  }

  // URL publique (le bucket etant public)
  const { data: pub } = service.storage.from('recipe-images').getPublicUrl(path);

  const payload: RecipePhotoUploadResponse = {
    signedUrl: signed.signedUrl,
    path: signed.path,
    token: signed.token,
    publicUrl: pub.publicUrl,
  };
  return c.json(payload);
});

// ============================================================================
// DELETE /api/recipes/:id/photo : supprime la photo courante du Storage
// ============================================================================
recipesRouter.delete('/recipes/:id/photo', async (c) => {
  const auth = getAuth(c);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing_id' }, 400);

  const sb = getUserClient(c.env, auth.accessToken);
  const { data: recipe, error: rErr } = await sb
    .from('recipes')
    .select('id, household_id, image_url')
    .eq('id', id)
    .maybeSingle();
  if (rErr) {
    return c.json({ error: 'db_error', message: rErr.message }, 500);
  }
  if (!recipe) return c.json({ error: 'not_found' }, 404);

  type R = { id: string; household_id: string; image_url: string | null };
  const r = recipe as unknown as R;
  if (r.image_url) {
    // Extrait le path apres "/recipe-images/"
    const m = r.image_url.match(/\/recipe-images\/(.+)$/);
    if (m?.[1]) {
      const path = m[1];
      const { error: rmErr } = await sb.storage.from('recipe-images').remove([path]);
      if (rmErr) {
        console.warn('[recipes] storage remove failed', rmErr);
        // on ne bloque pas, on continue pour clear le champ DB
      }
    }
  }

  // Clear image_url via update_recipe RPC (qui passe par RLS)
  const { error: updErr } = await sb.rpc('update_recipe', {
    p_recipe_id: id,
    p_recipe: { imageUrl: null },
    p_ingredients: null,
  });
  if (updErr) {
    return c.json({ error: 'db_error', message: updErr.message }, 500);
  }
  return c.json({ ok: true });
});
recipesRouter.post('/recipes/import', async (c) => {
  const auth = getAuth(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = ImportRecipeInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;

  let draft: Awaited<ReturnType<typeof importRecipeFromUrl>>;
  try {
    draft = await importRecipeFromUrl(input.url);
  } catch (err) {
    return c.json({ error: 'import_failed', message: (err as Error).message }, 400);
  }

  let recipeId: string | null = null;
  if (input.save) {
    const sb = getUserClient(c.env, auth.accessToken);
    const { data: created, error } = await sb.rpc('create_recipe', {
      p_household_id: input.householdId,
      p_recipe: {
        title: draft.title,
        description: draft.description ?? null,
        servings: draft.servings,
        prepTimeMin: draft.prepTimeMin ?? null,
        cookTimeMin: draft.cookTimeMin ?? null,
        steps: draft.steps.map((s, i) => ({
          id: `s-${Date.now()}-${i}`,
          text: s.text,
          durationMin: s.durationMin ?? null,
        })),
        dietTags: draft.dietTags,
        mealSlots: draft.mealSlots,
        source: 'api',
        sourceRef: input.url,
      },
      p_ingredients: draft.ingredients.map((i) => ({
        name: i.name,
        quantity: i.quantity ?? null,
        unit: i.unit ?? null,
        notes: i.notes ?? null,
      })),
    });
    if (error) {
      console.warn('[recipes/import] persistence failed', error);
    } else {
      const result = created as unknown as { recipe?: { id?: string } };
      recipeId = result?.recipe?.id ?? null;
    }
  }

  const payload: ImportRecipeResponse = {
    draft,
    recipeId,
    sourceUrl: input.url,
  };
  return c.json(payload);
});
