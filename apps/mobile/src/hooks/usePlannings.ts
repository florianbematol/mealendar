import {
  createPlanning,
  deletePlanning,
  generatePlanningWithLlm,
  getMealPlan,
  getPlanning,
  getShoppingList,
  listPlannings,
  setPlanningMeals,
  updatePlannedMeal,
  upsertMealPlan,
} from '@/lib/api';
import type {
  CreatePlanningInput,
  GeneratePlanningInput,
  PlanningWithMeals,
  SetPlanningMealsInput,
  UpdatePlannedMealInput,
  UpsertMealPlanInput,
} from '@mealendar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

export function usePlannings(householdId: string | null | undefined) {
  return useQuery({
    queryKey: ['plannings', householdId],
    queryFn: () => listPlannings(householdId as string),
    enabled: !!householdId,
    staleTime: 30_000,
  });
}

export function usePlanning(id: string | null | undefined) {
  return useQuery({
    queryKey: ['planning', id],
    queryFn: () => getPlanning(id as string),
    enabled: !!id,
  });
}

export function useCreatePlanning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlanningInput) => createPlanning(input),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['plannings', p.householdId] });
    },
  });
}

export function useSetPlanningMeals(planningId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetPlanningMealsInput) => setPlanningMeals(planningId, input),
    onSuccess: (planning: PlanningWithMeals) => {
      qc.setQueryData(['planning', planningId], planning);
      qc.invalidateQueries({ queryKey: ['plannings', planning.householdId] });
      qc.invalidateQueries({ queryKey: ['shopping-list', planningId] });
    },
  });
}

export function useUpdatePlannedMeal(planningId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mealId, input }: { mealId: string; input: UpdatePlannedMealInput }) =>
      updatePlannedMeal(mealId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planning', planningId] });
      qc.invalidateQueries({ queryKey: ['shopping-list', planningId] });
    },
  });
}

export function useDeletePlanning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; householdId: string }) => deletePlanning(id),
    onSuccess: (_, { id, householdId }) => {
      qc.invalidateQueries({ queryKey: ['plannings', householdId] });
      qc.removeQueries({ queryKey: ['planning', id] });
    },
  });
}

export function useShoppingList(planningId: string | null | undefined) {
  return useQuery({
    queryKey: ['shopping-list', planningId],
    queryFn: () => getShoppingList(planningId as string),
    enabled: !!planningId,
    staleTime: 10_000,
  });
}

export function useGeneratePlanningWithLlm(planningId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GeneratePlanningInput) => generatePlanningWithLlm(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planning', planningId] });
      qc.invalidateQueries({ queryKey: ['shopping-list', planningId] });
      qc.invalidateQueries({ queryKey: ['llm-quota'] });
    },
  });
}
