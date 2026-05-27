import {
  deletePlannedMeal,
  fetchHouseholdIcs,
  generatePlanningWithLlm,
  getMealPlan,
  getMealsRange,
  getShoppingList,
  setMealsRange,
  updatePlannedMeal,
  upsertMealPlan,
} from '@/lib/api';
import type {
  GeneratePlanningInput,
  MealsRange,
  SetMealsRangeInput,
  UpdatePlannedMealInput,
  UpsertMealPlanInput,
} from '@mealendar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Hooks "planning" version calendrier libre.
 *
 * Plus de notion de "planning" : on lit / ecrit des meals attaches au foyer
 * sur une fenetre [from, to] arbitraire (mois courant, semaine, range custom).
 */

// ---------------------------------------------------------------------------
// Plan-type (slot config + variety rules) - inchange
// ---------------------------------------------------------------------------

export function useMealPlan(householdId: string | null | undefined) {
  return useQuery({
    queryKey: ['meal-plan', householdId],
    queryFn: () => getMealPlan(householdId as string),
    enabled: !!householdId,
    staleTime: 60_000,
  });
}

export function useUpsertMealPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertMealPlanInput) => upsertMealPlan(input),
    onSuccess: (mp) => {
      qc.invalidateQueries({ queryKey: ['meal-plan', mp.householdId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Meals d'un foyer sur une fenetre [from, to]
// ---------------------------------------------------------------------------

/**
 * Cle de cache pour la query meals. Le client est libre de varier from/to
 * (vue mois, vue semaine, range custom). Toutes ces queries cohabitent.
 */
export function mealsRangeKey(householdId: string, from: string, to: string) {
  return ['meals', householdId, from, to] as const;
}

export function useMealsRange(
  householdId: string | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
) {
  return useQuery({
    queryKey: ['meals', householdId, from, to],
    queryFn: () => getMealsRange(householdId as string, from as string, to as string),
    enabled: !!householdId && !!from && !!to,
    staleTime: 30_000,
  });
}

/**
 * Mutation : remplace les meals dans une fenetre.
 * Met a jour le cache de la fenetre demandee + invalide les ranges
 * potentiellement chevauchants (on prend la voie large : invalidate par foyer).
 */
export function useSetMealsRange(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetMealsRangeInput) => setMealsRange(householdId, input),
    onSuccess: (range: MealsRange) => {
      qc.setQueryData(['meals', householdId, range.dateFrom, range.dateTo], range);
      qc.invalidateQueries({ queryKey: ['meals', householdId] });
      qc.invalidateQueries({ queryKey: ['shopping-list', householdId] });
    },
  });
}

/**
 * Mutation : edit unitaire d'un meal. Invalide tous les ranges du foyer.
 */
export function useUpdatePlannedMeal(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mealId, input }: { mealId: string; input: UpdatePlannedMealInput }) =>
      updatePlannedMeal(mealId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meals', householdId] });
      qc.invalidateQueries({ queryKey: ['shopping-list', householdId] });
    },
  });
}

/**
 * Mutation : suppression d'un meal individuel.
 */
export function useDeletePlannedMeal(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mealId: string) => deletePlannedMeal(mealId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meals', householdId] });
      qc.invalidateQueries({ queryKey: ['shopping-list', householdId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Liste de courses sur une fenetre
// ---------------------------------------------------------------------------

export function useShoppingList(
  householdId: string | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
) {
  return useQuery({
    queryKey: ['shopping-list', householdId, from, to],
    queryFn: () => getShoppingList(householdId as string, from as string, to as string),
    enabled: !!householdId && !!from && !!to,
    staleTime: 10_000,
  });
}

// ---------------------------------------------------------------------------
// LLM full-planning sur une fenetre
// ---------------------------------------------------------------------------

export function useGeneratePlanningWithLlm(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GeneratePlanningInput) => generatePlanningWithLlm(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meals', householdId] });
      qc.invalidateQueries({ queryKey: ['shopping-list', householdId] });
      qc.invalidateQueries({ queryKey: ['llm-quota'] });
    },
  });
}

// ---------------------------------------------------------------------------
// ICS export (utilitaire wrappant la fonction api)
// ---------------------------------------------------------------------------

export async function fetchIcsForRange(
  householdId: string,
  from: string,
  to: string,
): Promise<string> {
  return fetchHouseholdIcs(householdId, from, to);
}
