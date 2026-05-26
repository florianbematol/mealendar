/**
 * Client LLM unifie : Gemini Flash en primaire, Groq en fallback.
 * Les deux sont gratuits dans leur free tier ; le routing est automatique :
 *  - Gemini d'abord (qualite + JSON mode)
 *  - Si Gemini KO ou rate-limited, fallback Groq (Llama 3.x)
 *
 * Tous les appels passent par le KV CACHE (TTL 90 jours par defaut) avec
 * cle = hash SHA-256 du prompt normalise.
 */

import {
  type GenerateRecipeInput,
  type LlmPlanningOutput,
  LlmPlanningOutputSchema,
  type LlmRecipeDraft,
  LlmRecipeDraftSchema,
} from '@mealendar/shared';
import { sha256Hex } from './hash';

export type LlmCallOutcome = {
  draft: LlmRecipeDraft;
  model: string;
  cacheHit: boolean;
  tokensIn?: number;
  tokensOut?: number;
};

const CACHE_TTL_S = 60 * 60 * 24 * 90; // 90 jours

const SYSTEM_PROMPT = `Tu es un chef cuisinier qui repond UNIQUEMENT en JSON valide, sans aucun texte autour.
Le JSON doit respecter exactement ce schema :
{
  "title": string (1-200 chars),
  "description": string ou null (court resume),
  "servings": int (1-20, defaut 4),
  "prepTimeMin": int ou null,
  "cookTimeMin": int ou null,
  "steps": array de { "text": string (1-2000 chars), "durationMin": int ou null },
  "dietTags": string[] (parmi : "vegetarian", "vegan", "pescatarian", "gluten_free", "lactose_free", "halal", "kosher", "low_carb", "high_protein"),
  "mealSlots": string[] (parmi : "breakfast", "lunch", "snack", "dinner"),
  "ingredients": array de { "name": string, "quantity": number ou null, "unit": string ou null, "notes": string ou null }
}
Respecte les contraintes (regimes, allergenes a eviter, slots cibles). Reponds en francais.
Quantites en unites usuelles : g, kg, ml, cl, l, piece, c.a.s, c.a.c.

Pour "steps" : decoupe la recette en etapes COURTES et CONCRETES (1 action par step, ex "Faire revenir l'oignon emince dans l'huile chaude jusqu'a ce qu'il soit translucide"). N'utilise PAS de numerotation dans le texte (pas de "1. ", "Etape 2 : "). Indique "durationMin" uniquement si l'etape implique une duree mesurable (cuisson, repos, marinade). Vise 4 a 12 steps.`;

function buildUserPrompt(input: GenerateRecipeInput): string {
  const lines: string[] = [];
  lines.push(`Idee : ${input.prompt.trim()}`);
  if (input.servings) lines.push(`Pour ${input.servings} personnes`);
  if (input.maxKcal) lines.push(`Maximum ${input.maxKcal} kcal par portion`);
  if (input.dietTags.length > 0) {
    lines.push(`Regimes a respecter : ${input.dietTags.join(', ')}`);
  }
  if (input.mealSlots.length > 0) {
    lines.push(`Adapte a : ${input.mealSlots.join(', ')}`);
  }
  if (input.avoidAllergens.length > 0) {
    lines.push(`Eviter absolument : ${input.avoidAllergens.join(', ')}`);
  }
  if (input.dietComponents && input.dietComponents.length > 0) {
    lines.push('');
    lines.push('La recette DOIT contenir ces composants (plan alimentaire) :');
    for (const comp of input.dietComponents) {
      const alts = comp.alternatives
        .map((a) => {
          const qty =
            a.qtyMin != null && a.qtyMax != null && a.qtyMin !== a.qtyMax
              ? `${a.qtyMin}-${a.qtyMax}`
              : (a.qtyMin ?? a.qtyMax ?? '');
          return `${a.label}${qty ? ` ${qty}${a.unit ?? ''}` : ''}`;
        })
        .join(' OU ');
      const opt = comp.required ? '' : ' (optionnel)';
      lines.push(`- ${comp.label}${opt} : ${alts}`);
    }
  }
  return lines.join('\n');
}

/**
 * Normalise l'input pour avoir une cle de cache stable :
 *  - lowercase + trim du prompt
 *  - tableaux tries
 *  - kcal arrondi a la dizaine
 */
function normalizeForCache(input: GenerateRecipeInput): string {
  const norm = {
    p: input.prompt.trim().toLowerCase(),
    s: input.servings ?? null,
    k: input.maxKcal ? Math.round(input.maxKcal / 10) * 10 : null,
    d: [...input.dietTags].sort(),
    m: [...input.mealSlots].sort(),
    a: [...input.avoidAllergens].sort().map((s) => s.toLowerCase()),
    dc: input.dietComponents
      ? input.dietComponents.map((c) => ({
          l: c.label.toLowerCase(),
          r: c.required,
          a: c.alternatives.map((a) => ({
            c: a.category,
            qmin: a.qtyMin ?? null,
            qmax: a.qtyMax ?? null,
            u: a.unit ?? null,
          })),
        }))
      : null,
  };
  return JSON.stringify(norm);
}

export async function getCachedDraft(
  input: GenerateRecipeInput,
  cache: KVNamespace,
): Promise<{ key: string; cached: LlmRecipeDraft | null }> {
  const norm = normalizeForCache(input);
  const hash = await sha256Hex(norm);
  const key = `llm:recipe:${hash}`;
  const value = await cache.get(key, 'json');
  if (!value) return { key, cached: null };
  const parsed = LlmRecipeDraftSchema.safeParse(value);
  if (!parsed.success) return { key, cached: null };
  return { key, cached: parsed.data };
}

export async function putCachedDraft(
  key: string,
  draft: LlmRecipeDraft,
  cache: KVNamespace,
): Promise<void> {
  await cache.put(key, JSON.stringify(draft), { expirationTtl: CACHE_TTL_S });
}

/**
 * Appel Gemini Flash en JSON mode.
 * Doc : https://ai.google.dev/gemini-api/docs/structured-output
 */
async function callGemini(
  apiKey: string,
  userPrompt: string,
): Promise<{ draft: LlmRecipeDraft; tokensIn?: number; tokensOut?: number; model: string }> {
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    systemInstruction: {
      role: 'system',
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.8,
      responseMimeType: 'application/json',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const draft = parseDraftJson(text);
  return {
    draft,
    tokensIn: data.usageMetadata?.promptTokenCount,
    tokensOut: data.usageMetadata?.candidatesTokenCount,
    model,
  };
}

/**
 * Appel Groq (compat OpenAI, JSON mode).
 * Doc : https://console.groq.com/docs/api-reference#chat-create
 */
async function callGroq(
  apiKey: string,
  userPrompt: string,
): Promise<{ draft: LlmRecipeDraft; tokensIn?: number; tokensOut?: number; model: string }> {
  const model = 'llama-3.3-70b-versatile';
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      temperature: 0.8,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Groq ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = data.choices?.[0]?.message?.content ?? '';
  const draft = parseDraftJson(content);
  return {
    draft,
    tokensIn: data.usage?.prompt_tokens,
    tokensOut: data.usage?.completion_tokens,
    model,
  };
}

function parseDraftJson(raw: string): LlmRecipeDraft {
  // Certains modeles ajoutent des fences ```json ...``` ; on nettoie.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`LLM JSON parse error: ${(e as Error).message}`);
  }
  const validated = LlmRecipeDraftSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `LLM output validation failed: ${validated.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return validated.data;
}

export async function generateRecipeDraft(
  input: GenerateRecipeInput,
  env: { GEMINI_API_KEY?: string; GROQ_API_KEY?: string; CACHE?: KVNamespace },
): Promise<LlmCallOutcome> {
  // 1. Cache lookup
  if (env.CACHE) {
    const { key, cached } = await getCachedDraft(input, env.CACHE);
    if (cached) {
      return { draft: cached, model: 'cache', cacheHit: true };
    }
    // 2. LLM call
    const userPrompt = buildUserPrompt(input);
    const outcome = await callPrimaryThenFallback(userPrompt, env);
    await putCachedDraft(key, outcome.draft, env.CACHE);
    return { ...outcome, cacheHit: false };
  }
  const userPrompt = buildUserPrompt(input);
  const outcome = await callPrimaryThenFallback(userPrompt, env);
  return { ...outcome, cacheHit: false };
}

/**
 * Erreur levee quand aucune cle LLM n'est configuree cote serveur.
 * On la differencie pour pouvoir renvoyer un 503 explicite.
 */
export class LlmNotConfiguredError extends Error {
  constructor() {
    super('Aucun fournisseur LLM configure cote serveur (GEMINI_API_KEY ou GROQ_API_KEY).');
    this.name = 'LlmNotConfiguredError';
  }
}

async function callPrimaryThenFallback(
  userPrompt: string,
  env: { GEMINI_API_KEY?: string; GROQ_API_KEY?: string },
): Promise<{ draft: LlmRecipeDraft; tokensIn?: number; tokensOut?: number; model: string }> {
  const errors: string[] = [];

  if (env.GEMINI_API_KEY) {
    try {
      return await callGemini(env.GEMINI_API_KEY, userPrompt);
    } catch (err) {
      const msg = (err as Error).message;
      console.warn('[llm] gemini failed, trying fallback:', msg);
      errors.push(`gemini: ${msg}`);
    }
  }
  if (env.GROQ_API_KEY) {
    try {
      return await callGroq(env.GROQ_API_KEY, userPrompt);
    } catch (err) {
      errors.push(`groq: ${(err as Error).message}`);
    }
  }
  if (errors.length === 0) {
    throw new LlmNotConfiguredError();
  }
  throw new Error(`Tous les fournisseurs LLM ont echoue : ${errors.join(' | ')}`);
}

// ============================================================================
// LLM full-planning : on remplit toute la fenetre date/slot d'un coup en
// piochant parmi les recettes existantes du foyer.
// ============================================================================

export type PlanningRecipeContext = {
  id: string;
  title: string;
  servings: number;
  mealSlots: string[];
  dietTags: string[];
  description?: string | null;
};

export type PlanningSlotContext = {
  date: string; // YYYY-MM-DD
  weekday: string; // ex "monday"
  slotKey: string;
  /**
   * Composants enrichis du diet plan agrege pour ce slot (tous les membres
   * presents, qty additionnees). Format : "Proteine (200-300g viande OU 150g poisson)".
   */
  dietComponents?: {
    label: string;
    required: boolean;
    /** Texte deja format pour le prompt : "200-300g viande OU 2 oeufs". */
    altsText: string;
  }[];
  /** Regimes restrictifs union des membres presents (si vide -> aucun). */
  regimes?: string[];
  /** Allergies union des membres presents. */
  allergies?: string[];
  /** Si un meal locked est deja la, on note son recipeId pour ne pas l'ecraser. */
  lockedRecipeId?: string | null;
};

export type GeneratePlanningContext = {
  startDate: string;
  endDate: string;
  /** ex 2 = au moins 2 jours entre 2 occurrences de la meme recette */
  minDaysBetweenSameRecipe: number;
  /** ex 4 = nb de personnes du foyer (sert au LLM pour servings & coversDays) */
  memberCount: number;
  /** Slots a remplir, dans l'ordre temporel */
  slots: PlanningSlotContext[];
  /** Bibliotheque de recettes disponibles */
  recipes: PlanningRecipeContext[];
  /** Texte libre additionnel (regimes, envies, ...) */
  hint?: string;
};

const PLANNING_SYSTEM_PROMPT = `Tu es un assistant de planification de repas qui repond UNIQUEMENT en JSON valide, sans aucun texte autour.

Ton role : remplir un planning de repas en piochant UNIQUEMENT parmi la liste de recettes fournie (par leur "id"). Tu ne dois JAMAIS inventer un id.

Le JSON doit respecter exactement ce schema :
{
  "meals": [
    { "date": "YYYY-MM-DD", "slotKey": string, "recipeId": string-uuid ou null, "coversDays": int 1..3, "reason": string optionnel }
  ],
  "summary": string optionnel (1-2 phrases en francais)
}

Regles :
- Une entree par (date, slotKey) demande dans la liste "slotsToFill".
- Si tu reutilises une recette, "recipeId" doit correspondre EXACTEMENT a un id de la liste "recipes".
- Si aucune recette ne convient pour un slot, mets "recipeId": null et un "reason" court ("aucune recette diner adaptee dans la bibliotheque").
- Respecte "minDaysBetweenSameRecipe" : ne propose pas la meme recette a moins de N jours.
- Si une recette est marquee dans "mealSlots" comme convenant a un slot, prefere-la pour ce slot.
- Si tu marques "coversDays" > 1 pour un meal, NE remplis PAS le meme slot pour les jours couverts (le repas du lendemain est le reste).
- Respecte les composants requis du diet plan : chaque slot liste les composants attendus avec leurs alternatives et quantites cumulees pour le foyer (ex "Proteine -> 200-300g viande OU 150g poisson").
- Si un slot a "regimes" (vegetarian, vegan, gluten_free, lactose_free, halal, kosher, low_carb, high_protein) : la recette choisie doit OBLIGATOIREMENT respecter ces regimes (verifie via mealSlots et tags des recettes).
- Si un slot a "allergies" : la recette choisie ne doit JAMAIS contenir un de ces aliments (ex "arachide" -> pas de cacahuetes).
- Si "lockedRecipeId" est present pour un slot, tu DOIS reutiliser cet id et coversDays=1.
- Reponds en francais pour le summary.`;

function buildPlanningUserPrompt(ctx: GeneratePlanningContext): string {
  const lines: string[] = [];
  lines.push(`Periode : ${ctx.startDate} au ${ctx.endDate}`);
  lines.push(`Foyer : ${ctx.memberCount} personnes`);
  lines.push(`minDaysBetweenSameRecipe : ${ctx.minDaysBetweenSameRecipe}`);
  if (ctx.hint?.trim()) {
    lines.push(`Indication libre : ${ctx.hint.trim()}`);
  }
  lines.push('');
  lines.push(`Slots a remplir (${ctx.slots.length}) :`);
  for (const s of ctx.slots) {
    const parts = [`- ${s.date} ${s.weekday} ${s.slotKey}`];
    if (s.lockedRecipeId) parts.push(`[locked recipeId=${s.lockedRecipeId}]`);
    if (s.regimes && s.regimes.length > 0) {
      parts.push(`regimes:[${s.regimes.join(',')}]`);
    }
    if (s.allergies && s.allergies.length > 0) {
      parts.push(`allergies:[${s.allergies.join(',')}]`);
    }
    lines.push(parts.join(' '));
    if (s.dietComponents && s.dietComponents.length > 0) {
      for (const c of s.dietComponents) {
        const flag = c.required ? '' : ' (optionnel)';
        lines.push(`    requis: ${c.label}${flag} -> ${c.altsText}`);
      }
    }
  }
  lines.push('');
  lines.push(`Recettes disponibles (${ctx.recipes.length}) :`);
  for (const r of ctx.recipes) {
    const slots = r.mealSlots.length > 0 ? r.mealSlots.join(',') : 'any';
    const tags = r.dietTags.length > 0 ? ` tags=${r.dietTags.join(',')}` : '';
    lines.push(`- id=${r.id} slots=${slots}${tags} servings=${r.servings} : ${r.title}`);
  }
  return lines.join('\n');
}

/**
 * Cle de cache : on hash le contexte normalise (les recettes triees par id,
 * slots triees par (date, slotKey)). Sans hint perso pour eviter d'avoir
 * 1 cle differente par run.
 *
 * Note : on ne met PAS le hint en cle car il est tres variable (intention).
 * En contrepartie, on tronque le TTL a 7 jours pour ce cache (vs 90j pour
 * les recettes individuelles).
 */
function normalizePlanningForCache(ctx: GeneratePlanningContext): string {
  const norm = {
    p: `${ctx.startDate}|${ctx.endDate}`,
    m: ctx.memberCount,
    v: ctx.minDaysBetweenSameRecipe,
    s: [...ctx.slots]
      .sort((a, b) => `${a.date}|${a.slotKey}`.localeCompare(`${b.date}|${b.slotKey}`))
      .map((s) => ({
        d: s.date,
        sk: s.slotKey,
        l: s.lockedRecipeId ?? null,
        dc: (s.dietComponents ?? []).map((c) => `${c.label.toLowerCase()}|${c.altsText}`).sort(),
        rg: [...(s.regimes ?? [])].sort(),
        al: [...(s.allergies ?? [])].sort(),
      })),
    r: [...ctx.recipes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => ({
        i: r.id,
        s: [...r.mealSlots].sort(),
        t: [...r.dietTags].sort(),
      })),
  };
  return JSON.stringify(norm);
}

const PLANNING_CACHE_TTL_S = 60 * 60 * 24 * 7; // 7 jours

async function callGeminiPlanning(
  apiKey: string,
  userPrompt: string,
): Promise<{ output: LlmPlanningOutput; tokensIn?: number; tokensOut?: number; model: string }> {
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { role: 'system', parts: [{ text: PLANNING_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0.7, responseMimeType: 'application/json' },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const output = parsePlanningJson(text);
  return {
    output,
    tokensIn: data.usageMetadata?.promptTokenCount,
    tokensOut: data.usageMetadata?.candidatesTokenCount,
    model,
  };
}

async function callGroqPlanning(
  apiKey: string,
  userPrompt: string,
): Promise<{ output: LlmPlanningOutput; tokensIn?: number; tokensOut?: number; model: string }> {
  const model = 'llama-3.3-70b-versatile';
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      temperature: 0.7,
      messages: [
        { role: 'system', content: PLANNING_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Groq ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = data.choices?.[0]?.message?.content ?? '';
  const output = parsePlanningJson(content);
  return {
    output,
    tokensIn: data.usage?.prompt_tokens,
    tokensOut: data.usage?.completion_tokens,
    model,
  };
}

function parsePlanningJson(raw: string): LlmPlanningOutput {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`LLM planning JSON parse error: ${(e as Error).message}`);
  }
  const validated = LlmPlanningOutputSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `LLM planning output validation failed: ${validated.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return validated.data;
}

export type LlmPlanningOutcome = {
  output: LlmPlanningOutput;
  model: string;
  cacheHit: boolean;
  tokensIn?: number;
  tokensOut?: number;
};

export async function generatePlanningDraft(
  ctx: GeneratePlanningContext,
  env: { GEMINI_API_KEY?: string; GROQ_API_KEY?: string; CACHE?: KVNamespace },
): Promise<LlmPlanningOutcome> {
  const userPrompt = buildPlanningUserPrompt(ctx);

  // Cache (sans hint)
  let cacheKey: string | null = null;
  if (env.CACHE && (!ctx.hint || ctx.hint.trim() === '')) {
    const norm = normalizePlanningForCache(ctx);
    const hash = await sha256Hex(norm);
    cacheKey = `llm:planning:${hash}`;
    const cached = await env.CACHE.get(cacheKey, 'json');
    if (cached) {
      const parsed = LlmPlanningOutputSchema.safeParse(cached);
      if (parsed.success) {
        return { output: parsed.data, model: 'cache', cacheHit: true };
      }
    }
  }

  const errors: string[] = [];
  let outcome: {
    output: LlmPlanningOutput;
    tokensIn?: number;
    tokensOut?: number;
    model: string;
  } | null = null;

  if (env.GEMINI_API_KEY) {
    try {
      outcome = await callGeminiPlanning(env.GEMINI_API_KEY, userPrompt);
    } catch (err) {
      const msg = (err as Error).message;
      console.warn('[llm-planning] gemini failed:', msg);
      errors.push(`gemini: ${msg}`);
    }
  }
  if (!outcome && env.GROQ_API_KEY) {
    try {
      outcome = await callGroqPlanning(env.GROQ_API_KEY, userPrompt);
    } catch (err) {
      errors.push(`groq: ${(err as Error).message}`);
    }
  }
  if (!outcome) {
    if (errors.length === 0) throw new LlmNotConfiguredError();
    throw new Error(`Tous les fournisseurs LLM ont echoue : ${errors.join(' | ')}`);
  }

  if (cacheKey && env.CACHE) {
    await env.CACHE.put(cacheKey, JSON.stringify(outcome.output), {
      expirationTtl: PLANNING_CACHE_TTL_S,
    });
  }

  return { ...outcome, cacheHit: false };
}
