/**
 * Importe une recette depuis une URL en parsant le JSON-LD schema.org/Recipe.
 * La plupart des sites de cuisine populaires (Marmiton, 750g, AllRecipes, etc.)
 * exposent ce format pour les SEO.
 *
 * Approche simple :
 *  1. Fetch HTML
 *  2. Extraction des <script type="application/ld+json">
 *  3. Walk JSON, recherche d'un objet @type = "Recipe"
 *  4. Mapping vers notre LlmRecipeDraft
 */

import { type LlmRecipeDraft, LlmRecipeDraftSchema } from '@mealendar/shared';

type LdJson = Record<string, unknown> | unknown[];

function parseDuration(iso: unknown): number | null {
  if (typeof iso !== 'string') return null;
  // ISO 8601 duration : PT15M, PT1H30M, etc.
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const h = m[1] ? Number.parseInt(m[1], 10) : 0;
  const min = m[2] ? Number.parseInt(m[2], 10) : 0;
  return h * 60 + min;
}

function parseServings(input: unknown): number {
  if (typeof input === 'number' && input > 0) return Math.floor(input);
  if (typeof input === 'string') {
    const m = input.match(/(\d+)/);
    if (m?.[1]) return Number.parseInt(m[1], 10);
  }
  return 4;
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string') return (v[0] as string).trim();
  if (typeof v === 'object' && v !== null) {
    const obj = v as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text.trim();
    if (typeof obj.name === 'string') return obj.name.trim();
  }
  return null;
}

export function parseInstructionsToSteps(input: unknown): { text: string }[] {
  if (typeof input === 'string') {
    // Split sur les sauts de ligne ou les numerotations "1. ", "2) "
    return input
      .split(/\n+|(?:^|\s)\d+[\.\)]\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((text) => ({ text }));
  }
  if (Array.isArray(input)) {
    return input
      .map((step) => asString(step))
      .filter((s): s is string => !!s)
      .map((text) => ({ text }));
  }
  return [];
}

function parseIngredient(raw: string): {
  name: string;
  quantity: number | null;
  unit: string | null;
} {
  const text = raw.trim();
  // Tente d'extraire qty + unit + nom : "500 g de farine", "2 oeufs"
  const m = text.match(
    /^([\d.,]+)\s*(g|kg|ml|cl|l|pi[èe]ces?|c\.?\s*[aà]\s*[sc]\.?|cuill[èe]res?(?:\s*[aà]\s*soupe|\s*[aà]\s*caf[ée])?)?\s*(?:de\s+|d')?(.+)$/i,
  );
  if (m) {
    const qtyRaw = (m[1] ?? '').replace(',', '.');
    const qty = Number.parseFloat(qtyRaw);
    let unit: string | null = m[2] ?? null;
    if (unit) {
      const u = unit.toLowerCase().replace(/\s+/g, '');
      if (u.startsWith('cuillere') || u.startsWith('cuillère')) {
        unit = u.includes('soupe')
          ? 'c.a.s'
          : u.includes('cafe') || u.includes('café')
            ? 'c.a.c'
            : null;
      } else if (u.startsWith('piece') || u.startsWith('pièce')) {
        unit = 'piece';
      } else {
        unit = u;
      }
    }
    const name = (m[3] ?? '').trim();
    return {
      name: name || text,
      quantity: Number.isFinite(qty) ? qty : null,
      unit,
    };
  }
  return { name: text, quantity: null, unit: null };
}

function findRecipeNode(node: LdJson): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeNode(item as LdJson);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object' || node === null) return null;
  const obj = node as Record<string, unknown>;
  const t = obj['@type'];
  if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return obj;
  if (Array.isArray(obj['@graph'])) {
    return findRecipeNode(obj['@graph'] as unknown[]);
  }
  return null;
}

function extractLdJson(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      out.push(parsed);
    } catch {
      // Certains sites ont du JSON-LD invalide ; on ignore.
    }
  }
  return out;
}

export async function importRecipeFromUrl(url: string): Promise<LlmRecipeDraft> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'Mealendar/0.1 (https://github.com/anomalyco/mealendar)',
        Accept: 'text/html',
      },
      redirect: 'follow',
    });
  } catch (err) {
    throw new Error(`Network error: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} - ${res.statusText}`);
  }
  const html = await res.text();
  const jsonBlocks = extractLdJson(html);
  let recipe: Record<string, unknown> | null = null;
  for (const block of jsonBlocks) {
    recipe = findRecipeNode(block as LdJson);
    if (recipe) break;
  }
  if (!recipe) {
    throw new Error('Aucune recette schema.org trouvee sur cette page');
  }

  const title = asString(recipe.name) ?? 'Recette importee';
  const description = asString(recipe.description);
  const servings = parseServings(recipe.recipeYield);
  const prepTime = parseDuration(recipe.prepTime);
  const cookTime = parseDuration(recipe.cookTime);
  const steps = parseInstructionsToSteps(recipe.recipeInstructions);

  const ingredientsRaw = recipe.recipeIngredient ?? recipe.ingredients ?? [];
  const ingredientsArr = Array.isArray(ingredientsRaw) ? ingredientsRaw : [];
  const ingredients = ingredientsArr
    .map((i) => (typeof i === 'string' ? parseIngredient(i) : null))
    .filter((i): i is NonNullable<typeof i> => !!i);

  if (ingredients.length === 0) {
    throw new Error("Pas d'ingredients trouves sur cette page");
  }

  const draft: LlmRecipeDraft = {
    title,
    description,
    servings,
    prepTimeMin: prepTime,
    cookTimeMin: cookTime,
    steps:
      steps.length > 0
        ? steps
        : [{ text: `Ingredients : ${ingredients.map((i) => i.name).join(', ')}` }],
    dietTags: [],
    mealSlots: [],
    ingredients: ingredients.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
    })),
  };

  // Validation pour s'assurer du shape correct
  return LlmRecipeDraftSchema.parse(draft);
}
