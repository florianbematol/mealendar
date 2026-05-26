import { getIngredientsByIds, lookupBarcode, searchIngredients, upsertIngredient } from '@/lib/api';
import { type RecipeMacros, computeRecipeMacros } from '@/lib/macros';
import type { Ingredient, RecipeWithIngredients, UpsertIngredientInput } from '@mealendar/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

/**
 * Debounce un string sur un delay donne.
 * Utile pour les recherches afin de limiter les appels API.
 */
export function useDebounced<T>(value: T, delayMs = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

export function useSearchIngredients(
  householdId: string | null | undefined,
  query: string,
  limit = 15,
) {
  const debounced = useDebounced(query, 250);
  return useQuery({
    queryKey: ['ingredients', 'search', householdId, debounced, limit],
    queryFn: () => searchIngredients(householdId as string, debounced, limit),
    enabled: !!householdId,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useBarcodeLookup() {
  return useMutation({
    mutationFn: (ean: string) => lookupBarcode(ean),
  });
}

export function useUpsertIngredient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertIngredientInput) => upsertIngredient(input),
    onSuccess: (ing) => {
      qc.invalidateQueries({ queryKey: ['ingredients', 'search', ing.householdId] });
      qc.invalidateQueries({ queryKey: ['ingredients', 'search', null] });
    },
  });
}

/**
 * Fetch un batch d'ingredients par leurs IDs (cachable).
 */
export function useIngredientsByIds(ids: string[]) {
  const stableKey = useMemo(() => [...ids].sort().join(','), [ids]);
  return useQuery({
    queryKey: ['ingredients', 'by-ids', stableKey],
    queryFn: () => getIngredientsByIds(ids),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
}

/**
 * Hook qui calcule les macros d'une recette : recupere les ingredients lies
 * et applique computeRecipeMacros.
 */
export function useRecipeMacros(recipe: RecipeWithIngredients | null | undefined): {
  macros: RecipeMacros | null;
  isLoading: boolean;
} {
  const ids = useMemo(() => {
    if (!recipe) return [];
    return [
      ...new Set(recipe.ingredients.map((i) => i.ingredientId).filter((x): x is string => !!x)),
    ];
  }, [recipe]);

  const ingredients = useIngredientsByIds(ids);

  const map = useMemo(() => {
    const m = new Map<string, Ingredient>();
    for (const ing of ingredients.data ?? []) m.set(ing.id, ing);
    return m;
  }, [ingredients.data]);

  if (!recipe) return { macros: null, isLoading: false };
  if (ids.length > 0 && ingredients.isPending) {
    return { macros: null, isLoading: true };
  }

  return {
    macros: computeRecipeMacros(recipe.ingredients, recipe.servings, map),
    isLoading: false,
  };
}
