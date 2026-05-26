import {
  createRecipe,
  deleteRecipe,
  getRecipe,
  importRecipeFromUrl,
  listRecipes,
  toggleRecipeFavorite,
  updateRecipe,
} from '@/lib/api';
import type {
  CreateRecipeInput,
  ImportRecipeInput,
  RecipeWithIngredients,
  UpdateRecipeInput,
} from '@mealendar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export function useRecipes(householdId: string | null | undefined) {
  return useQuery({
    queryKey: ['recipes', householdId],
    queryFn: () => listRecipes(householdId as string),
    enabled: !!householdId,
    staleTime: 30_000,
  });
}

export function useRecipe(id: string | null | undefined) {
  return useQuery({
    queryKey: ['recipe', id],
    queryFn: () => getRecipe(id as string),
    enabled: !!id,
  });
}

export function useCreateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRecipeInput) => createRecipe(input),
    onSuccess: (recipe) => {
      qc.invalidateQueries({ queryKey: ['recipes', recipe.householdId] });
      qc.setQueryData(['recipe', recipe.id], recipe);
    },
  });
}

export function useUpdateRecipe(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRecipeInput) => updateRecipe(id, input),
    onSuccess: (recipe: RecipeWithIngredients) => {
      qc.invalidateQueries({ queryKey: ['recipes', recipe.householdId] });
      qc.setQueryData(['recipe', recipe.id], recipe);
    },
  });
}

export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; householdId: string }) => deleteRecipe(id),
    onSuccess: (_, { id, householdId }) => {
      qc.invalidateQueries({ queryKey: ['recipes', householdId] });
      qc.removeQueries({ queryKey: ['recipe', id] });
    },
  });
}

export function useToggleRecipeFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; householdId: string }) => toggleRecipeFavorite(id),
    onSuccess: (isFavorite, { id, householdId }) => {
      qc.invalidateQueries({ queryKey: ['recipes', householdId] });
      qc.setQueryData<RecipeWithIngredients | undefined>(['recipe', id], (cur) =>
        cur ? { ...cur, isFavorite } : cur,
      );
    },
  });
}

export function useImportRecipeFromUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportRecipeInput) => importRecipeFromUrl(input),
    onSuccess: (res, vars) => {
      if (res.recipeId) {
        qc.invalidateQueries({ queryKey: ['recipes', vars.householdId] });
      }
    },
  });
}
