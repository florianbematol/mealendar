import {
  type DietComponent,
  GeneratePlanningInputSchema,
  type GeneratePlanningResponse,
  GenerateRecipeInputSchema,
  type GenerateRecipeResponse,
  type LlmQuotaResponse,
  type RecipeWithIngredients,
  type UserDietPlan,
  aggregateDietPlansForSlot,
} from '@mealendar/shared';
import { Hono } from 'hono';
import type { Bindings } from '../index';
import { sha256Hex } from '../lib/hash';
import {
  type GeneratePlanningContext,
  LlmNotConfiguredError,
  generatePlanningDraft,
  generateRecipeDraft,
} from '../lib/llm';
import { getUserClient } from '../lib/supabase';
import { getAuth, requireAuth } from '../middleware/auth';

export const llmRouter = new Hono<{ Bindings: Bindings }>();

llmRouter.use('*', requireAuth());

/** Limite par utilisateur sur 24h. Cache hits ne comptent pas. */
const DAILY_LIMIT = 50;

// ============================================================================
// GET /api/llm/quota : etat du rate limit pour l'utilisateur courant
// ============================================================================
llmRouter.get('/llm/quota', async (c) => {
  const auth = getAuth(c);
  const sb = getUserClient(c.env, auth.accessToken);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await sb.rpc('count_llm_usage_since', { p_since: since });
  if (error) {
    console.error('[llm/quota] rpc failed', error);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  const used = typeof data === 'number' ? data : 0;
  const remaining = Math.max(0, DAILY_LIMIT - used);
  const payload: LlmQuotaResponse = {
    dailyLimit: DAILY_LIMIT,
    used24h: used,
    remaining,
  };
  return c.json(payload);
});

// ============================================================================
// POST /api/llm/generate-recipe : genere une recette (Gemini Flash + fallback)
//
// Rate limit : DAILY_LIMIT generations LLM / user / 24h (cache hits exclus).
// Cache : KV (90 jours), key = SHA-256 du prompt normalise.
// Si input.save = true, persiste la recette via la RPC create_recipe.
// ============================================================================
llmRouter.post('/llm/generate-recipe', async (c) => {
  const auth = getAuth(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = GenerateRecipeInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;

  const sb = getUserClient(c.env, auth.accessToken);

  // 1. Rate limit (compte les appels non-cache des dernieres 24h)
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: usedData, error: countErr } = await sb.rpc('count_llm_usage_since', {
    p_since: since,
  });
  if (countErr) {
    console.error('[llm/generate] count rpc failed', countErr);
    return c.json({ error: 'db_error', message: countErr.message }, 500);
  }
  const used = typeof usedData === 'number' ? usedData : 0;
  if (used >= DAILY_LIMIT) {
    return c.json(
      {
        error: 'rate_limited',
        message: `Limite quotidienne atteinte (${DAILY_LIMIT} generations / 24h). Reessayez plus tard.`,
        used24h: used,
        dailyLimit: DAILY_LIMIT,
      },
      429,
    );
  }

  // 2. Generation (cache + LLM)
  let outcome: Awaited<ReturnType<typeof generateRecipeDraft>>;
  try {
    outcome = await generateRecipeDraft(input, {
      GEMINI_API_KEY: c.env.GEMINI_API_KEY,
      GROQ_API_KEY: c.env.GROQ_API_KEY,
      CACHE: c.env.CACHE,
    });
  } catch (err) {
    console.error('[llm/generate] LLM call failed', err);
    if (err instanceof LlmNotConfiguredError) {
      return c.json(
        {
          error: 'llm_not_configured',
          message: err.message,
          hint: "L'admin doit definir GEMINI_API_KEY ou GROQ_API_KEY (cf. apps/api/.dev.vars en local, ou wrangler secret put en prod).",
        },
        503,
      );
    }
    return c.json(
      {
        error: 'llm_failed',
        message: (err as Error).message,
      },
      502,
    );
  }

  // 3. Audit (best-effort, non bloquant)
  const promptHash = await sha256Hex(input.prompt.trim().toLowerCase());
  void sb
    .rpc('record_llm_usage', {
      p_household_id: input.householdId,
      p_kind: 'recipe',
      p_model: outcome.model,
      p_prompt_hash: promptHash,
      p_cache_hit: outcome.cacheHit,
      p_tokens_in: outcome.tokensIn ?? null,
      p_tokens_out: outcome.tokensOut ?? null,
    })
    .then(({ error }) => {
      if (error) console.warn('[llm/generate] record_llm_usage failed', error);
    });

  // 4. Persistance optionnelle via create_recipe RPC
  let recipeId: string | null = null;
  if (input.save) {
    const { data: created, error: createErr } = await sb.rpc('create_recipe', {
      p_household_id: input.householdId,
      p_recipe: {
        title: outcome.draft.title,
        description: outcome.draft.description ?? null,
        servings: outcome.draft.servings,
        prepTimeMin: outcome.draft.prepTimeMin ?? null,
        cookTimeMin: outcome.draft.cookTimeMin ?? null,
        steps: outcome.draft.steps.map((s, i) => ({
          id: `s-${Date.now()}-${i}`,
          text: s.text,
          durationMin: s.durationMin ?? null,
        })),
        dietTags: outcome.draft.dietTags,
        mealSlots: outcome.draft.mealSlots,
        source: 'llm',
        sourceRef: outcome.model,
      },
      p_ingredients: outcome.draft.ingredients.map((i) => ({
        name: i.name,
        quantity: i.quantity ?? null,
        unit: i.unit ?? null,
        notes: i.notes ?? null,
      })),
    });
    if (createErr) {
      console.warn('[llm/generate] persistence failed', createErr);
    } else {
      const result = created as unknown as { recipe?: { id?: string } };
      recipeId = result?.recipe?.id ?? null;
    }
  }

  const payload: GenerateRecipeResponse = {
    draft: outcome.draft,
    recipeId,
    meta: {
      model: outcome.model,
      cacheHit: outcome.cacheHit,
      generatedAt: new Date().toISOString(),
    },
  };
  // Touche unused : on tient `RecipeWithIngredients` sous le coude pour les prochaines phases.
  void ((): RecipeWithIngredients | null => null);
  return c.json(payload);
});

// ============================================================================
// POST /api/llm/generate-planning : remplit un planning entier d'un coup
//
// Strategie : on construit un contexte (slots a remplir, recettes dispos,
// diet plan, varietyRules, locked meals), on l'envoie au LLM qui repond avec
// un mapping (date, slot) -> recipeId. On applique le resultat via
// set_planning_meals (en preservant les locked).
// ============================================================================
llmRouter.post('/llm/generate-planning', async (c) => {
  const auth = getAuth(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = GeneratePlanningInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const input = parsed.data;
  const sb = getUserClient(c.env, auth.accessToken);

  // 1. Verifie l'appartenance + recupere les bornes
  const { data: hh, error: hhErr } = await sb
    .from('households')
    .select('id')
    .eq('id', input.householdId)
    .maybeSingle();
  if (hhErr || !hh) {
    return c.json({ error: 'not_found', message: 'Foyer introuvable' }, 404);
  }
  const startDate = input.dateFrom;
  const endDate = input.dateTo;

  // 2. Rate limit (un seul appel LLM = 1 unit)
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: usedData, error: countErr } = await sb.rpc('count_llm_usage_since', {
    p_since: since,
  });
  if (countErr) {
    return c.json({ error: 'db_error', message: countErr.message }, 500);
  }
  const used = typeof usedData === 'number' ? usedData : 0;
  if (used >= DAILY_LIMIT) {
    return c.json(
      {
        error: 'rate_limited',
        message: `Limite quotidienne atteinte (${DAILY_LIMIT} generations / 24h).`,
        used24h: used,
        dailyLimit: DAILY_LIMIT,
      },
      429,
    );
  }

  // 3. Charge meal_plan (slot config + variety) du foyer.
  //    Le diet_plan global est deprecated -> on utilise user_diet_plans agreges.
  const { data: mp, error: mpErr } = await sb
    .from('meal_plans')
    .select('slot_config, variety_rules')
    .eq('household_id', input.householdId)
    .maybeSingle();
  if (mpErr) {
    return c.json({ error: 'db_error', message: mpErr.message }, 500);
  }
  type SlotEntry = { key: string; time?: string };
  type SlotConfig = Record<string, SlotEntry[]>;
  type VarietyRules = { minDaysBetweenSameRecipe?: number };
  const mealPlan = (mp ?? null) as unknown as {
    slot_config: SlotConfig;
    variety_rules: VarietyRules | null;
  } | null;

  if (!mealPlan?.slot_config) {
    return c.json(
      {
        error: 'no_meal_plan',
        message: "Configurez d'abord un plan-type (slots) avant de generer un planning IA.",
      },
      400,
    );
  }

  // 3b. Charge les profils dietetiques de tous les membres du foyer
  const { data: dietPlansData, error: dpErr } = await sb.rpc('list_household_diet_plans', {
    p_household_id: input.householdId,
  });
  if (dpErr) {
    return c.json({ error: 'db_error', message: dpErr.message }, 500);
  }
  type DietPlanRow = {
    user_id: string;
    diet_plan: unknown;
    regimes: string[] | null;
    allergies: string[] | null;
  };
  const memberDietPlans = ((dietPlansData ?? []) as unknown as DietPlanRow[]).map((r) => ({
    userId: r.user_id,
    dietPlan: r.diet_plan as { slots?: Record<string, DietComponent[]> } | null,
    regimes: r.regimes ?? [],
    allergies: r.allergies ?? [],
  }));

  // 4. Recettes du foyer (id, titre, slots, tags, servings)
  const { data: recipesRows, error: recErr } = await sb
    .from('recipes')
    .select('id, title, servings, meal_slots, diet_tags, description')
    .eq('household_id', input.householdId)
    .order('created_at', { ascending: false })
    .limit(150);
  if (recErr) {
    return c.json({ error: 'db_error', message: recErr.message }, 500);
  }
  type RecipeRow = {
    id: string;
    title: string;
    servings: number;
    meal_slots: string[] | null;
    diet_tags: string[] | null;
    description: string | null;
  };
  const recipes = ((recipesRows ?? []) as unknown as RecipeRow[]).map((r) => ({
    id: r.id,
    title: r.title,
    servings: r.servings,
    mealSlots: r.meal_slots ?? [],
    dietTags: r.diet_tags ?? [],
    description: r.description,
  }));
  if (recipes.length === 0) {
    return c.json(
      {
        error: 'no_recipes',
        message: 'Aucune recette dans votre bibliotheque. Creez-en au moins quelques unes.',
      },
      400,
    );
  }

  // 5. Meals deja presents dans la fenetre (pour les locked + variete)
  const { data: mealsRows, error: mealsErr } = await sb
    .from('planned_meals')
    .select('date, slot_key, recipe_id, locked')
    .eq('household_id', input.householdId)
    .gte('date', startDate)
    .lte('date', endDate);
  if (mealsErr) {
    return c.json({ error: 'db_error', message: mealsErr.message }, 500);
  }
  type MealRow = {
    date: string;
    slot_key: string;
    recipe_id: string | null;
    locked: boolean;
  };
  const lockedMap = new Map<string, string | null>();
  for (const m of (mealsRows ?? []) as unknown as MealRow[]) {
    if (m.locked) {
      lockedMap.set(`${m.date}|${m.slot_key}`, m.recipe_id);
    }
  }

  // 6. Membre count (pour servings)
  const { data: members, error: memErr } = await sb
    .from('household_members')
    .select('user_id', { count: 'exact', head: false })
    .eq('household_id', input.householdId);
  const memberCount = memErr ? 4 : Math.max(1, (members ?? []).length);

  // 7. Construit la liste des slots a remplir (date x slotKey du plan-type)
  //    en utilisant rangeDates + weekdayOf, et en agregeant les diet plans
  //    de tous les membres pour chaque slot.
  const { rangeDates, weekdayOf } = await import('../lib/dates');
  const dates = rangeDates(startDate, endDate);
  const slotsToFill: GeneratePlanningContext['slots'] = [];

  // Construit les UserDietPlan minimaux pour aggregateDietPlansForSlot.
  // On a besoin du dietPlan structure (slots) + regimes + allergies.
  const aggInputs: UserDietPlan[] = memberDietPlans.map((m) => ({
    id: m.userId,
    userId: m.userId,
    userEmail: null,
    householdId: input.householdId,
    dietPlan: (m.dietPlan ?? {
      slots: {},
      dailyRules: [],
      note: null,
    }) as UserDietPlan['dietPlan'],
    regimes: m.regimes as UserDietPlan['regimes'],
    allergies: m.allergies,
    goals: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  for (const date of dates) {
    const wd = weekdayOf(date);
    const slotEntries = mealPlan.slot_config[wd] ?? [];
    for (const s of slotEntries) {
      const key = `${date}|${s.key}`;
      const agg = aggregateDietPlansForSlot(aggInputs, s.key);
      slotsToFill.push({
        date,
        weekday: wd,
        slotKey: s.key,
        lockedRecipeId: lockedMap.get(key) ?? null,
        dietComponents: agg.components.map((c) => ({
          label: c.label,
          required: c.required,
          altsText: formatAlternativesForPrompt(c),
        })),
        regimes: agg.regimes,
        allergies: agg.allergies,
      });
    }
  }

  if (slotsToFill.length === 0) {
    return c.json(
      {
        error: 'no_slots',
        message:
          'Aucun slot a remplir : verifiez la configuration du plan-type pour les jours de la semaine.',
      },
      400,
    );
  }

  // 8. Appel LLM
  const ctx: GeneratePlanningContext = {
    startDate: startDate,
    endDate: endDate,
    minDaysBetweenSameRecipe: mealPlan.variety_rules?.minDaysBetweenSameRecipe ?? 2,
    memberCount,
    slots: slotsToFill,
    recipes,
    hint: input.hint,
  };
  let outcome: Awaited<ReturnType<typeof generatePlanningDraft>>;
  try {
    outcome = await generatePlanningDraft(ctx, {
      GEMINI_API_KEY: c.env.GEMINI_API_KEY,
      GROQ_API_KEY: c.env.GROQ_API_KEY,
      CACHE: c.env.CACHE,
    });
  } catch (err) {
    if (err instanceof LlmNotConfiguredError) {
      return c.json(
        {
          error: 'llm_not_configured',
          message: err.message,
          hint: "L'admin doit definir GEMINI_API_KEY ou GROQ_API_KEY.",
        },
        503,
      );
    }
    return c.json({ error: 'llm_failed', message: (err as Error).message }, 502);
  }

  // 9. Audit
  const promptHash = await sha256Hex(
    `planning:${input.householdId}:${startDate}:${endDate}:${slotsToFill.length}`,
  );
  void sb
    .rpc('record_llm_usage', {
      p_household_id: input.householdId,
      p_kind: 'planning',
      p_model: outcome.model,
      p_prompt_hash: promptHash,
      p_cache_hit: outcome.cacheHit,
      p_tokens_in: outcome.tokensIn ?? null,
      p_tokens_out: outcome.tokensOut ?? null,
    })
    .then(({ error }) => {
      if (error) console.warn('[llm/generate-planning] record_llm_usage failed', error);
    });

  // 10. Filtre les meals : recipeId doit etre dans la liste des recipes connues
  const knownIds = new Set(recipes.map((r) => r.id));
  const validMeals = outcome.output.meals.filter((m) => {
    if (m.recipeId && !knownIds.has(m.recipeId)) return false;
    return true;
  });

  // 11. Persistance via set_planning_meals (preserve les locked)
  //     On combine les meals LLM avec les meals locked deja presents (si pas dans la liste retournee).
  const finalMeals = validMeals
    .filter((m) => m.recipeId !== null)
    .map((m) => ({
      date: m.date,
      slotKey: m.slotKey,
      recipeId: m.recipeId,
      servings: memberCount * (m.coversMeals ?? 1),
      diners: [],
      locked: false,
      position: 0,
      coversMeals: m.coversMeals ?? 1,
    }));

  const { error: setErr } = await sb.rpc('set_meals_for_range', {
    p_household_id: input.householdId,
    p_date_from: startDate,
    p_date_to: endDate,
    p_meals: finalMeals,
    p_keep_locked: input.keepLocked,
  });
  if (setErr) {
    console.error('[llm/generate-planning] set_meals_for_range failed', setErr);
    return c.json({ error: 'db_error', message: setErr.message }, 500);
  }

  const filled = finalMeals.length;
  const skipped = slotsToFill.length - filled - lockedMap.size;
  const payload: GeneratePlanningResponse = {
    output: outcome.output,
    filled,
    skipped: Math.max(0, skipped),
    meta: {
      model: outcome.model,
      cacheHit: outcome.cacheHit,
      generatedAt: new Date().toISOString(),
    },
  };
  return c.json(payload);
});

/**
 * Formate les alternatives d'un composant pour l'inclusion dans le prompt LLM.
 * Ex output : "200-300g viande OU 150g poisson OU 2 piece oeuf"
 */
function formatAlternativesForPrompt(comp: DietComponent): string {
  return comp.alternatives
    .map((a) => {
      let qty = '';
      if (a.qtyMin != null && a.qtyMax != null && a.qtyMin !== a.qtyMax) {
        qty = `${a.qtyMin}-${a.qtyMax}`;
      } else if (a.qtyMin != null) {
        qty = String(a.qtyMin);
      } else if (a.qtyMax != null) {
        qty = String(a.qtyMax);
      }
      const unit = a.unit ?? '';
      const qtyStr = qty ? `${qty}${unit}` : '';
      return qtyStr ? `${qtyStr} ${a.label}` : a.label;
    })
    .join(' OU ');
}
