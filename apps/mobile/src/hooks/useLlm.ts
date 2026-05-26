import { generateRecipeWithLlm, getLlmQuota } from '@/lib/api';
import type { GenerateRecipeInput } from '@mealendar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export function useLlmQuota(enabled = true) {
  return useQuery({
    queryKey: ['llm', 'quota'],
    queryFn: getLlmQuota,
    enabled,
    staleTime: 60_000,
  });
}

export function useGenerateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateRecipeInput) => generateRecipeWithLlm(input),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ['llm', 'quota'] });
      // Si la recette a ete sauvegardee, on invalide la liste des recettes du foyer
      if (res.recipeId) {
        qc.invalidateQueries({ queryKey: ['recipes', vars.householdId] });
      }
    },
  });
}
