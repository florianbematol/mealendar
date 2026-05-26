import {
  type BarcodeLookupResponse,
  BarcodeLookupResponseSchema,
  type CreateHouseholdInput,
  type CreatePlanningInput,
  type CreateRecipeInput,
  type GeneratePlanningInput,
  type GeneratePlanningResponse,
  GeneratePlanningResponseSchema,
  type GenerateRecipeInput,
  type GenerateRecipeResponse,
  GenerateRecipeResponseSchema,
  type HealthResponse,
  HealthResponseSchema,
  type HouseholdDetail,
  HouseholdDetailSchema,
  type HouseholdDietPlansResponse,
  HouseholdDietPlansResponseSchema,
  type HouseholdSummary,
  HouseholdSummarySchema,
  type ImportRecipeInput,
  type ImportRecipeResponse,
  ImportRecipeResponseSchema,
  type Ingredient,
  IngredientSchema,
  type JoinHouseholdInput,
  type ListRecipesResponse,
  ListRecipesResponseSchema,
  type LlmQuotaResponse,
  LlmQuotaResponseSchema,
  type MeResponse,
  MeResponseSchema,
  type MealPlan,
  MealPlanSchema,
  type OffProduct,
  OffProductSchema,
  type PlannedMeal,
  PlannedMealSchema,
  type Planning,
  PlanningSchema,
  type PlanningWithMeals,
  PlanningWithMealsSchema,
  type RecipePhotoUploadInput,
  type RecipePhotoUploadResponse,
  RecipePhotoUploadResponseSchema,
  type RecipeWithIngredients,
  RecipeWithIngredientsSchema,
  type RegisterPushTokenInput,
  type SearchIngredientsResponse,
  SearchIngredientsResponseSchema,
  type SetPlanningMealsInput,
  type ShoppingListResponse,
  ShoppingListResponseSchema,
  type UpdatePlannedMealInput,
  type UpdateRecipeInput,
  type UpsertIngredientInput,
  type UpsertMealPlanInput,
  type UpsertUserDietPlanInput,
  type UserDietPlan,
  UserDietPlanSchema,
} from '@mealendar/shared';
import { z } from 'zod';
import { API_BASE_URL } from './config';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function buildAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return {};
  return { Authorization: `Bearer ${data.session.access_token}` };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const authHeaders = await buildAuthHeaders();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // non-JSON body
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const data = await request<unknown>('/health');
  return HealthResponseSchema.parse(data);
}

/**
 * Endpoint de debug : retourne ce que voit Postgres pour l'auth (auth.uid, role).
 * Sans validation Zod (la forme est libre cote serveur).
 */
export async function fetchWhoami(): Promise<unknown> {
  return await request<unknown>('/api/whoami');
}

export async function fetchMe(): Promise<MeResponse> {
  const data = await request<unknown>('/api/me');
  return MeResponseSchema.parse(data);
}

export async function createHousehold(input: CreateHouseholdInput): Promise<HouseholdSummary> {
  const data = await request<unknown>('/api/households', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return HouseholdSummarySchema.parse(data);
}

export async function joinHousehold(input: JoinHouseholdInput): Promise<HouseholdSummary> {
  const data = await request<unknown>('/api/households/join', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return HouseholdSummarySchema.parse(data);
}

export async function getHouseholdDetail(id: string): Promise<HouseholdDetail> {
  const data = await request<unknown>(`/api/households/${id}`);
  return HouseholdDetailSchema.parse(data);
}

const RegenInviteResponseSchema = z.object({ inviteCode: z.string() });
export async function regenerateInviteCode(id: string): Promise<string> {
  const data = await request<unknown>(`/api/households/${id}/regenerate-invite-code`, {
    method: 'POST',
  });
  return RegenInviteResponseSchema.parse(data).inviteCode;
}

export async function leaveHousehold(id: string): Promise<void> {
  await request<unknown>(`/api/households/${id}/leave`, { method: 'POST' });
}

export async function deleteHousehold(id: string): Promise<void> {
  await request<unknown>(`/api/households/${id}`, { method: 'DELETE' });
}

// ===========================================================================
// Recettes
// ===========================================================================

export async function listRecipes(householdId: string): Promise<ListRecipesResponse> {
  const data = await request<unknown>(`/api/households/${householdId}/recipes`);
  return ListRecipesResponseSchema.parse(data);
}

export async function getRecipe(id: string): Promise<RecipeWithIngredients> {
  const data = await request<unknown>(`/api/recipes/${id}`);
  return RecipeWithIngredientsSchema.parse(data);
}

export async function createRecipe(input: CreateRecipeInput): Promise<RecipeWithIngredients> {
  const data = await request<unknown>('/api/recipes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return RecipeWithIngredientsSchema.parse(data);
}

export async function updateRecipe(
  id: string,
  input: UpdateRecipeInput,
): Promise<RecipeWithIngredients> {
  const data = await request<unknown>(`/api/recipes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return RecipeWithIngredientsSchema.parse(data);
}

export async function deleteRecipe(id: string): Promise<void> {
  await request<unknown>(`/api/recipes/${id}`, { method: 'DELETE' });
}

const ToggleFavoriteResponseSchema = z.object({ isFavorite: z.boolean() });
export async function toggleRecipeFavorite(id: string): Promise<boolean> {
  const data = await request<unknown>(`/api/recipes/${id}/favorite`, { method: 'POST' });
  return ToggleFavoriteResponseSchema.parse(data).isFavorite;
}

export async function importRecipeFromUrl(input: ImportRecipeInput): Promise<ImportRecipeResponse> {
  const data = await request<unknown>('/api/recipes/import', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return ImportRecipeResponseSchema.parse(data);
}

/**
 * Demande au backend une signed upload URL pour Supabase Storage.
 */
export async function getRecipePhotoUploadUrl(
  recipeId: string,
  contentType: 'image/jpeg' | 'image/png' | 'image/webp',
  ext: string,
): Promise<RecipePhotoUploadResponse> {
  const data = await request<unknown>(`/api/recipes/${recipeId}/photo-upload-url`, {
    method: 'POST',
    body: JSON.stringify({ contentType, ext } satisfies Omit<RecipePhotoUploadInput, 'recipeId'>),
  });
  return RecipePhotoUploadResponseSchema.parse(data);
}

/**
 * Effectue le PUT vers la signed URL Supabase Storage.
 */
export async function uploadFileToSignedUrl(
  signedUrl: string,
  fileBlob: Blob,
  contentType: string,
): Promise<void> {
  const res = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: fileBlob,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(`Upload failed: ${text || res.statusText}`, res.status);
  }
}

export async function deleteRecipePhoto(recipeId: string): Promise<void> {
  await request<unknown>(`/api/recipes/${recipeId}/photo`, { method: 'DELETE' });
}

// ===========================================================================
// Plan-type & Plannings
// ===========================================================================

const GetMealPlanResponseSchema = z.object({ mealPlan: MealPlanSchema.nullable() });
export async function getMealPlan(householdId: string): Promise<MealPlan | null> {
  const data = await request<unknown>(`/api/households/${householdId}/meal-plan`);
  return GetMealPlanResponseSchema.parse(data).mealPlan;
}

const UpsertMealPlanResponseSchema = z.object({ mealPlan: MealPlanSchema });
export async function upsertMealPlan(input: UpsertMealPlanInput): Promise<MealPlan> {
  const data = await request<unknown>('/api/meal-plan', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return UpsertMealPlanResponseSchema.parse(data).mealPlan;
}

const ListPlanningsResponseSchema = z.object({ items: z.array(PlanningSchema) });
export async function listPlannings(householdId: string): Promise<Planning[]> {
  const data = await request<unknown>(`/api/households/${householdId}/plannings`);
  return ListPlanningsResponseSchema.parse(data).items;
}

export async function getPlanning(id: string): Promise<PlanningWithMeals> {
  const data = await request<unknown>(`/api/plannings/${id}`);
  return PlanningWithMealsSchema.parse(data);
}

export async function createPlanning(input: CreatePlanningInput): Promise<Planning> {
  const data = await request<unknown>('/api/plannings', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return PlanningSchema.parse(data);
}

export async function setPlanningMeals(
  planningId: string,
  input: SetPlanningMealsInput,
): Promise<PlanningWithMeals> {
  const data = await request<unknown>(`/api/plannings/${planningId}/meals`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return PlanningWithMealsSchema.parse(data);
}

export async function updatePlannedMeal(
  mealId: string,
  input: UpdatePlannedMealInput,
): Promise<PlannedMeal> {
  const data = await request<unknown>(`/api/planned-meals/${mealId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return PlannedMealSchema.parse(data);
}

export async function deletePlanning(id: string): Promise<void> {
  await request<unknown>(`/api/plannings/${id}`, { method: 'DELETE' });
}

export async function getShoppingList(planningId: string): Promise<ShoppingListResponse> {
  const data = await request<unknown>(`/api/plannings/${planningId}/shopping-list`);
  return ShoppingListResponseSchema.parse(data);
}

/**
 * URL absolue (avec auth en query si besoin) du fichier ICS d'un planning.
 * Le client mobile va plutot fetch le contenu directement et l'ecrire pour partage.
 */
export async function fetchPlanningIcs(planningId: string): Promise<string> {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new ApiError('Not authenticated', 401);
  const res = await fetch(`${API_BASE_URL}/api/plannings/${planningId}/ics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status}`, res.status);
  }
  return await res.text();
}

// ===========================================================================
// Ingredients & Open Food Facts
// ===========================================================================

export async function searchIngredients(
  householdId: string,
  q: string,
  limit = 20,
): Promise<SearchIngredientsResponse> {
  const params = new URLSearchParams({
    householdId,
    q,
    limit: String(limit),
  });
  const data = await request<unknown>(`/api/ingredients/search?${params.toString()}`);
  return SearchIngredientsResponseSchema.parse(data);
}

export async function lookupBarcode(ean: string): Promise<BarcodeLookupResponse> {
  const data = await request<unknown>(`/api/ingredients/barcode/${encodeURIComponent(ean)}`);
  return BarcodeLookupResponseSchema.parse(data);
}

const OffSearchResponseSchema = z.object({ items: z.array(OffProductSchema) });
export async function searchOpenFoodFacts(q: string, limit = 10): Promise<OffProduct[]> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  const data = await request<unknown>(`/api/ingredients/off-search?${params.toString()}`);
  return OffSearchResponseSchema.parse(data).items;
}

const IngredientsByIdsResponseSchema = z.object({ items: z.array(IngredientSchema) });
export async function getIngredientsByIds(ids: string[]): Promise<Ingredient[]> {
  if (ids.length === 0) return [];
  const params = new URLSearchParams({ ids: ids.join(',') });
  const data = await request<unknown>(`/api/ingredients/by-ids?${params.toString()}`);
  return IngredientsByIdsResponseSchema.parse(data).items;
}

export async function upsertIngredient(input: UpsertIngredientInput): Promise<Ingredient> {
  const data = await request<unknown>('/api/ingredients', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return IngredientSchema.parse(data);
}

// ===========================================================================
// LLM : generation de recettes
// ===========================================================================

export async function getLlmQuota(): Promise<LlmQuotaResponse> {
  const data = await request<unknown>('/api/llm/quota');
  return LlmQuotaResponseSchema.parse(data);
}

export async function generateRecipeWithLlm(
  input: GenerateRecipeInput,
): Promise<GenerateRecipeResponse> {
  const data = await request<unknown>('/api/llm/generate-recipe', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return GenerateRecipeResponseSchema.parse(data);
}

export async function generatePlanningWithLlm(
  input: GeneratePlanningInput,
): Promise<GeneratePlanningResponse> {
  const data = await request<unknown>('/api/llm/generate-planning', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return GeneratePlanningResponseSchema.parse(data);
}

// ===========================================================================
// User diet plans (Phase 5.5)
// ===========================================================================

export async function getMyDietPlan(householdId: string): Promise<UserDietPlan | null> {
  const data = await request<unknown>(
    `/api/me/diet-plan?householdId=${encodeURIComponent(householdId)}`,
  );
  if (data === null) return null;
  return UserDietPlanSchema.parse(data);
}

export async function upsertMyDietPlan(input: UpsertUserDietPlanInput): Promise<UserDietPlan> {
  const data = await request<unknown>('/api/me/diet-plan', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return UserDietPlanSchema.parse(data);
}

export async function listHouseholdDietPlans(
  householdId: string,
): Promise<HouseholdDietPlansResponse> {
  const data = await request<unknown>(`/api/households/${householdId}/diet-plans`);
  return HouseholdDietPlansResponseSchema.parse(data);
}

// ===========================================================================
// Push notifications (Phase 5.4)
// ===========================================================================

export async function registerPushToken(input: RegisterPushTokenInput): Promise<void> {
  await request<unknown>('/api/me/push-tokens', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function unregisterPushToken(token: string): Promise<void> {
  await request<unknown>(`/api/me/push-tokens/${encodeURIComponent(token)}`, {
    method: 'DELETE',
  });
}

export async function setPushEnabled(enabled: boolean): Promise<void> {
  await request<unknown>('/api/me/push-enabled', {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}
