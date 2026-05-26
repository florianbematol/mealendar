/**
 * Calcul des macros d'une recette a partir des ingredients lies
 * (recipe_ingredients.ingredientId presente => recupere via getIngredient/cache).
 *
 * Approche simple et explicite : on convertit chaque quantite vers les grammes
 * via une table de conversion locale (g/kg/ml/cl/l = volume->masse approximative
 * a 1g/ml par defaut, on prefere etre approximatif que de bloquer). Pour les
 * unites "piece"/"c.a.s"/"c.a.c", on utilise des poids moyens conventionnels
 * sauf si l'ingredient a son defaultUnit.
 *
 * Pour chaque ingredient :
 *   contribution_kcal = (quantite_g / 100) * kcal_100g
 * Le total est arrondi pour affichage.
 *
 * Si certains ingredients n'ont pas de macros connues, on retourne `incomplete: true`.
 */

import type { Ingredient, RecipeIngredient } from '@mealendar/shared';

const UNIT_TO_GRAMS: Record<string, number> = {
  // Masse directe
  g: 1,
  kg: 1000,
  // Volume -> masse (approx 1g/ml pour la plupart des ingredients courants)
  ml: 1,
  cl: 10,
  l: 1000,
  // Cuilleres (poids approximatif moyen tous ingredients confondus)
  'c.a.s': 15,
  cas: 15,
  cs: 15,
  'c.a.c': 5,
  cac: 5,
  cc: 5,
  // Pieces (impossible a deviner sans info de l'ingredient -> approximation)
  piece: 100,
  pieces: 100,
};

export type RecipeMacros = {
  perRecipe: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
  };
  perServing: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
  };
  /** true si au moins un ingredient n'a pas pu etre traite (manquant ou unite inconnue) */
  incomplete: boolean;
  /** nb d'ingredients dont les macros ont contribue */
  contributingCount: number;
  /** nb total d'ingredients */
  totalCount: number;
};

function unitToGrams(quantity: number, unit: string | null): number | null {
  if (!unit) return null;
  const key = unit.trim().toLowerCase().replace(/\s+/g, '');
  const factor = UNIT_TO_GRAMS[key];
  if (factor == null) return null;
  return quantity * factor;
}

export function computeRecipeMacros(
  recipeIngredients: RecipeIngredient[],
  servings: number,
  ingredientsById: Map<string, Ingredient>,
): RecipeMacros {
  let kcal = 0;
  let prot = 0;
  let carbs = 0;
  let fat = 0;
  let fiber = 0;
  let contributing = 0;
  let incomplete = false;

  for (const ri of recipeIngredients) {
    if (!ri.ingredientId || ri.quantity == null) {
      incomplete = true;
      continue;
    }
    const ing = ingredientsById.get(ri.ingredientId);
    if (!ing || ing.kcal100g == null) {
      incomplete = true;
      continue;
    }
    const grams = unitToGrams(ri.quantity, ri.unit);
    if (grams == null) {
      incomplete = true;
      continue;
    }
    const ratio = grams / 100;
    kcal += (ing.kcal100g ?? 0) * ratio;
    prot += (ing.protein100g ?? 0) * ratio;
    carbs += (ing.carbs100g ?? 0) * ratio;
    fat += (ing.fat100g ?? 0) * ratio;
    fiber += (ing.fiber100g ?? 0) * ratio;
    contributing += 1;
  }

  const safeServings = Math.max(1, servings || 1);
  const round = (n: number) => Math.round(n * 10) / 10;

  return {
    perRecipe: {
      kcal: Math.round(kcal),
      proteinG: round(prot),
      carbsG: round(carbs),
      fatG: round(fat),
      fiberG: round(fiber),
    },
    perServing: {
      kcal: Math.round(kcal / safeServings),
      proteinG: round(prot / safeServings),
      carbsG: round(carbs / safeServings),
      fatG: round(fat / safeServings),
      fiberG: round(fiber / safeServings),
    },
    incomplete,
    contributingCount: contributing,
    totalCount: recipeIngredients.length,
  };
}
