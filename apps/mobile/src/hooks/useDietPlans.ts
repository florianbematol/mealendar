import { getMyDietPlan, listHouseholdDietPlans, upsertMyDietPlan } from '@/lib/api';
import type { UpsertUserDietPlanInput } from '@mealendar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Mon profil dietetique pour un foyer donne (peut etre null si pas encore configure).
 */
export function useMyDietPlan(householdId: string | null | undefined) {
  return useQuery({
    queryKey: ['my-diet-plan', householdId],
    queryFn: () => getMyDietPlan(householdId as string),
    enabled: !!householdId,
    staleTime: 30_000,
  });
}

export function useUpsertMyDietPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertUserDietPlanInput) => upsertMyDietPlan(input),
    onSuccess: (data) => {
      qc.setQueryData(['my-diet-plan', data.householdId], data);
      qc.invalidateQueries({ queryKey: ['household-diet-plans', data.householdId] });
    },
  });
}

/**
 * Liste de tous les profils des membres du foyer (lecture seule).
 */
export function useHouseholdDietPlans(householdId: string | null | undefined) {
  return useQuery({
    queryKey: ['household-diet-plans', householdId],
    queryFn: () => listHouseholdDietPlans(householdId as string),
    enabled: !!householdId,
    staleTime: 30_000,
  });
}
