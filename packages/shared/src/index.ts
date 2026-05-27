import { z } from 'zod';

/**
 * Identifiants
 */
export const UuidSchema = z.string().uuid();
export type Uuid = z.infer<typeof UuidSchema>;

/**
 * Health check response (Worker -> Mobile)
 */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('mealendar-api'),
  version: z.string(),
  timestamp: z.string().datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * Foyer (household)
 */
export const HouseholdSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(100),
  ownerId: UuidSchema,
  createdAt: z.string().datetime(),
});
export type Household = z.infer<typeof HouseholdSchema>;

export const HouseholdMemberRoleSchema = z.enum(['owner', 'admin', 'member']);
export type HouseholdMemberRole = z.infer<typeof HouseholdMemberRoleSchema>;

/**
 * Profil dietetique d'un membre du foyer.
 * - diets : tags normalises (vegetarian, vegan, pescatarian, gluten_free, lactose_free, ...)
 * - allergies : codes Open Food Facts (en:milk, en:gluten, en:peanuts, ...)
 * - dailyTargets : cibles nutritionnelles journalieres
 */
export const DietTagSchema = z.enum([
  'vegetarian',
  'vegan',
  'pescatarian',
  'gluten_free',
  'lactose_free',
  'halal',
  'kosher',
  'low_carb',
  'high_protein',
]);
export type DietTag = z.infer<typeof DietTagSchema>;

export const DailyTargetsSchema = z.object({
  kcal: z.number().int().positive().optional(),
  proteinG: z.number().nonnegative().optional(),
  carbsG: z.number().nonnegative().optional(),
  fatG: z.number().nonnegative().optional(),
  fiberG: z.number().nonnegative().optional(),
});
export type DailyTargets = z.infer<typeof DailyTargetsSchema>;

export const DietaryProfileSchema = z.object({
  diets: z.array(DietTagSchema).default([]),
  allergies: z.array(z.string()).default([]),
  dailyTargets: DailyTargetsSchema.optional(),
});
export type DietaryProfile = z.infer<typeof DietaryProfileSchema>;

export const HouseholdMemberSchema = z.object({
  householdId: UuidSchema,
  userId: UuidSchema,
  role: HouseholdMemberRoleSchema,
  displayName: z.string().min(1).max(100).nullable(),
  dietaryProfile: DietaryProfileSchema.nullable(),
  joinedAt: z.string().datetime(),
});
export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;

/**
 * Reponse de /api/me : user authentifie + foyers auxquels il appartient.
 */
export const MeResponseSchema = z.object({
  user: z.object({
    id: UuidSchema,
    email: z.string().email().nullable(),
  }),
  households: z.array(
    z.object({
      id: UuidSchema,
      name: z.string(),
      role: HouseholdMemberRoleSchema,
      ownerId: UuidSchema,
      createdAt: z.string().datetime(),
    }),
  ),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/**
 * Body de POST /api/households : creation d'un foyer.
 */
export const CreateHouseholdInputSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  displayName: z.string().min(1).max(100).trim().optional(),
});
export type CreateHouseholdInput = z.infer<typeof CreateHouseholdInputSchema>;

/**
 * Body de POST /api/households/join : rejoindre un foyer via code d'invitation.
 */
export const JoinHouseholdInputSchema = z.object({
  inviteCode: z
    .string()
    .min(6)
    .max(16)
    .transform((s) => s.trim().toUpperCase()),
  displayName: z.string().min(1).max(100).trim().optional(),
});
export type JoinHouseholdInput = z.infer<typeof JoinHouseholdInputSchema>;

/**
 * Reponse a une creation/jonction de foyer.
 */
export const HouseholdSummarySchema = z.object({
  id: UuidSchema,
  name: z.string(),
  ownerId: UuidSchema,
  inviteCode: z.string().nullable(),
  role: HouseholdMemberRoleSchema,
  createdAt: z.string().datetime(),
});
export type HouseholdSummary = z.infer<typeof HouseholdSummarySchema>;

/**
 * Detail complet d'un foyer : owner + invite_code + membres
 */
export const HouseholdMemberDetailSchema = z.object({
  userId: UuidSchema,
  role: HouseholdMemberRoleSchema,
  displayName: z.string().nullable(),
  email: z.string().email().nullable(),
  joinedAt: z.string().datetime(),
});
export type HouseholdMemberDetail = z.infer<typeof HouseholdMemberDetailSchema>;

export const HouseholdDetailSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  ownerId: UuidSchema,
  inviteCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  members: z.array(HouseholdMemberDetailSchema),
});
export type HouseholdDetail = z.infer<typeof HouseholdDetailSchema>;

/**
 * Slots de repas
 */
export const MealSlotKeySchema = z
  .string()
  .regex(/^[a-z0-9_]+$/)
  .min(1)
  .max(32);
export type MealSlotKey = z.infer<typeof MealSlotKeySchema>;

export const SLOT_KEYS = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  snack: 'snack',
  dinner: 'dinner',
} as const;

/**
 * Slots consideres comme "repas principaux" pour le calcul de coversMeals.
 * Un repas avec coversMeals=2 couvre lui-meme + le prochain slot principal,
 * en sautant petit-dejeuner et gouter (qui ne sont pas consideres comme
 * principaux pour les restes).
 *
 * NB : on traite ici les keys par defaut. Si l'utilisateur a des slots
 * custom (ex 'brunch', 'apero'), ils ne seront pas consideres comme
 * principaux ; on peut etendre cette liste plus tard si necessaire.
 */
export const MAIN_MEAL_SLOTS: ReadonlyArray<string> = ['lunch', 'dinner'];

/**
 * Renvoie true si le slotKey est considere comme un "repas principal".
 */
export function isMainMealSlot(slotKey: string): boolean {
  return MAIN_MEAL_SLOTS.includes(slotKey);
}

/**
 * Categories d'ingredients (libres mais avec quelques presets pour l'UI).
 */
export const IngredientCategorySchema = z.enum([
  'feculent',
  'legume',
  'fruit',
  'proteine',
  'fromage',
  'matiere_grasse',
  'condiment',
  'epice',
  'autre',
]);
export type IngredientCategory = z.infer<typeof IngredientCategorySchema>;

/**
 * Ingredient
 */
export const IngredientSchema = z.object({
  id: UuidSchema,
  householdId: UuidSchema.nullable(),
  name: z.string().min(1).max(200),
  offBarcode: z.string().nullable(),
  defaultUnit: z.string().min(1).max(20),
  kcal100g: z.number().nullable(),
  protein100g: z.number().nullable(),
  carbs100g: z.number().nullable(),
  fat100g: z.number().nullable(),
  fiber100g: z.number().nullable(),
  category: z.string().nullable(),
  allergens: z.array(z.string()),
  createdBy: UuidSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

/**
 * Input pour upsert d'un ingredient (cote foyer ou cache OFF global).
 */
export const UpsertIngredientInputSchema = z.object({
  householdId: UuidSchema.nullable(),
  name: z.string().min(1).max(200).trim(),
  offBarcode: z.string().min(4).max(32).nullable().optional(),
  defaultUnit: z.string().min(1).max(20).default('g'),
  kcal100g: z.number().nonnegative().nullable().optional(),
  protein100g: z.number().nonnegative().nullable().optional(),
  carbs100g: z.number().nonnegative().nullable().optional(),
  fat100g: z.number().nonnegative().nullable().optional(),
  fiber100g: z.number().nonnegative().nullable().optional(),
  category: z.string().max(40).nullable().optional(),
  allergens: z.array(z.string()).default([]),
});
export type UpsertIngredientInput = z.infer<typeof UpsertIngredientInputSchema>;

export const SearchIngredientsResponseSchema = z.object({
  items: z.array(IngredientSchema),
});
export type SearchIngredientsResponse = z.infer<typeof SearchIngredientsResponseSchema>;

/**
 * Open Food Facts product (lecture brute apres lookup barcode).
 * On expose un sous-ensemble enrichi avec nos cles normalisees.
 */
export const OffProductSchema = z.object({
  barcode: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  imageUrl: z.string().url().nullable(),
  defaultUnit: z.string(),
  kcal100g: z.number().nullable(),
  protein100g: z.number().nullable(),
  carbs100g: z.number().nullable(),
  fat100g: z.number().nullable(),
  fiber100g: z.number().nullable(),
  category: z.string().nullable(),
  allergens: z.array(z.string()),
});
export type OffProduct = z.infer<typeof OffProductSchema>;

export const BarcodeLookupResponseSchema = z.object({
  found: z.boolean(),
  product: OffProductSchema.nullable(),
  ingredient: IngredientSchema.nullable(),
});
export type BarcodeLookupResponse = z.infer<typeof BarcodeLookupResponseSchema>;

/**
 * Recipe
 */
export const RecipeSourceSchema = z.enum(['user', 'llm', 'api']);
export type RecipeSource = z.infer<typeof RecipeSourceSchema>;

export const RecipeIngredientSchema = z.object({
  ingredientId: UuidSchema.nullable(),
  ingredientName: z.string().min(1).max(200),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  notes: z.string().nullable(),
  position: z.number().int(),
});
export type RecipeIngredient = z.infer<typeof RecipeIngredientSchema>;

/**
 * Une etape de recette : texte libre + duree optionnelle (pour timer).
 * `id` est un identifiant local (uid) utilise pour le tracking React (key).
 */
export const RecipeStepSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().min(1).max(2000),
  durationMin: z.number().int().nonnegative().nullable().optional(),
});
export type RecipeStep = z.infer<typeof RecipeStepSchema>;

export const RecipeSchema = z.object({
  id: UuidSchema,
  householdId: UuidSchema,
  title: z.string().min(1).max(200),
  description: z.string().nullable(),
  servings: z.number().int().positive(),
  prepTimeMin: z.number().int().nonnegative().nullable(),
  cookTimeMin: z.number().int().nonnegative().nullable(),
  steps: z.array(RecipeStepSchema).default([]),
  source: RecipeSourceSchema,
  sourceRef: z.string().nullable(),
  imageUrl: z.string().url().nullable(),
  dietTags: z.array(z.string()),
  mealSlots: z.array(z.string()),
  createdBy: UuidSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const RecipeWithIngredientsSchema = RecipeSchema.extend({
  ingredients: z.array(RecipeIngredientSchema),
  isFavorite: z.boolean().default(false),
});
export type RecipeWithIngredients = z.infer<typeof RecipeWithIngredientsSchema>;

export const RecipeListItemSchema = z.object({
  id: UuidSchema,
  householdId: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  servings: z.number().int().positive(),
  prepTimeMin: z.number().int().nonnegative().nullable(),
  cookTimeMin: z.number().int().nonnegative().nullable(),
  imageUrl: z.string().url().nullable(),
  source: RecipeSourceSchema,
  dietTags: z.array(z.string()),
  mealSlots: z.array(z.string()),
  ingredientCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  isFavorite: z.boolean().default(false),
});
export type RecipeListItem = z.infer<typeof RecipeListItemSchema>;

export const ListRecipesResponseSchema = z.object({
  items: z.array(RecipeListItemSchema),
});
export type ListRecipesResponse = z.infer<typeof ListRecipesResponseSchema>;

/**
 * Inputs CRUD recettes
 */
export const RecipeIngredientInputSchema = z.object({
  ingredientId: UuidSchema.nullable().optional(),
  name: z.string().min(1).max(200),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().min(1).max(20).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});
export type RecipeIngredientInput = z.infer<typeof RecipeIngredientInputSchema>;

export const CreateRecipeInputSchema = z.object({
  householdId: UuidSchema,
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(2000).nullable().optional(),
  servings: z.number().int().positive().default(4),
  prepTimeMin: z.number().int().nonnegative().nullable().optional(),
  cookTimeMin: z.number().int().nonnegative().nullable().optional(),
  steps: z.array(RecipeStepSchema).default([]),
  imageUrl: z.string().url().nullable().optional(),
  dietTags: z.array(z.string()).default([]),
  mealSlots: z.array(z.string()).default([]),
  ingredients: z.array(RecipeIngredientInputSchema).default([]),
});
export type CreateRecipeInput = z.infer<typeof CreateRecipeInputSchema>;

export const UpdateRecipeInputSchema = CreateRecipeInputSchema.omit({
  householdId: true,
}).partial();
export type UpdateRecipeInput = z.infer<typeof UpdateRecipeInputSchema>;

// ============================================================================
// Planning : plan-type, planning, planned_meals
// ============================================================================

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
export const WeekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof WeekdaySchema>;

/**
 * Slot dans la config du plan-type. `time` est optionnel (HH:MM).
 */
export const PlanSlotSchema = z.object({
  key: MealSlotKeySchema,
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
});
export type PlanSlot = z.infer<typeof PlanSlotSchema>;

/**
 * SlotConfig : pour chaque jour de la semaine, la liste des slots souhaites.
 */
export const SlotConfigSchema = z.record(WeekdaySchema, z.array(PlanSlotSchema));
export type SlotConfig = z.infer<typeof SlotConfigSchema>;

export const VarietyRulesSchema = z.object({
  minDaysBetweenSameRecipe: z.number().int().nonnegative().default(2),
});
export type VarietyRules = z.infer<typeof VarietyRulesSchema>;

// ============================================================================
// Plan alimentaire (style "plan diet" : composants par slot + regles journalieres)
// ============================================================================

/**
 * Categorie d'un aliment dans le plan alimentaire.
 * Liste large mais finie ; on autorise un fallback "autre" pour les cas non couverts.
 */
export const DietCategorySchema = z.enum([
  'legumes',
  'fruit',
  'viande',
  'poisson',
  'oeuf',
  'legumineuse',
  'feculent',
  'pain',
  'produit_laitier',
  'fromage',
  'fruits_a_coque',
  'matiere_grasse',
  'sucre',
  'autre',
]);
export type DietCategory = z.infer<typeof DietCategorySchema>;

/**
 * Une alternative dans un composant.
 * Exemple : "Viande 100-150g" est une alternative dans le composant "Proteine".
 */
export const DietAlternativeSchema = z.object({
  category: DietCategorySchema,
  /** Libelle libre pour l'utilisateur (ex : "Viande", "Poisson", "2 oeufs") */
  label: z.string().min(1).max(100),
  qtyMin: z.number().nonnegative().nullable().optional(),
  qtyMax: z.number().nonnegative().nullable().optional(),
  /** "g", "ml", "piece", "c.a.s", "c.a.c", "portion"... */
  unit: z.string().max(20).nullable().optional(),
  /** Note libre (ex : "moitie-moitie") */
  note: z.string().max(200).nullable().optional(),
});
export type DietAlternative = z.infer<typeof DietAlternativeSchema>;

/**
 * Un composant d'un repas : un libelle + au moins une alternative.
 *
 * Exemple : "Proteine = Viande 100-150g OU Poisson 150-200g OU 2 oeufs OU
 *            Legumineuses/quinoa 150-200g".
 *
 * required = true => le composant doit etre present dans le repas (cf. UI cocher).
 */
export const DietComponentSchema = z.object({
  id: z.string().min(1).max(40), // uid local pour edition
  label: z.string().min(1).max(100),
  required: z.boolean().default(true),
  alternatives: z.array(DietAlternativeSchema).min(1),
  note: z.string().max(200).nullable().optional(),
});
export type DietComponent = z.infer<typeof DietComponentSchema>;

/**
 * Plan alimentaire : pour chaque slot du plan-type, la liste des composants
 * attendus, plus les regles globales journalieres.
 */
export const DietPlanSchema = z.object({
  /** key : MealSlotKey ('breakfast', 'lunch'...) -> liste de composants */
  slots: z.record(MealSlotKeySchema, z.array(DietComponentSchema)).default({}),
  /** Regles journalieres globales (matieres grasses, sucres, hydratation...) */
  dailyRules: z.array(DietComponentSchema).default([]),
  /** Note libre globale */
  note: z.string().max(2000).nullable().optional(),
});
export type DietPlan = z.infer<typeof DietPlanSchema>;

/**
 * Template "diete equilibree" inspire d'un plan typique de dieteticien.
 * Utilisable comme starter dans l'UI.
 */
export const DEFAULT_DIET_PLAN_TEMPLATE: DietPlan = {
  slots: {
    lunch: [
      {
        id: 'lunch-vegetables',
        label: 'Legumes',
        required: true,
        alternatives: [
          {
            category: 'legumes',
            label: 'Legumes crus et/ou cuits',
            qtyMin: 100,
            qtyMax: 300,
            unit: 'g',
          },
        ],
      },
      {
        id: 'lunch-protein',
        label: 'Proteine',
        required: true,
        alternatives: [
          { category: 'viande', label: 'Viande', qtyMin: 100, qtyMax: 150, unit: 'g' },
          { category: 'poisson', label: 'Poisson', qtyMin: 150, qtyMax: 200, unit: 'g' },
          { category: 'oeuf', label: 'Oeufs', qtyMin: 2, qtyMax: 2, unit: 'piece' },
          {
            category: 'legumineuse',
            label: 'Legumineuses / quinoa',
            qtyMin: 150,
            qtyMax: 200,
            unit: 'g',
          },
        ],
      },
      {
        id: 'lunch-starch',
        label: 'Feculents',
        required: true,
        alternatives: [
          {
            category: 'feculent',
            label: 'Feculents cuits',
            qtyMin: 300,
            qtyMax: 300,
            unit: 'g',
            note: '10 c.a.s cuits',
          },
          { category: 'pain', label: 'Pain', qtyMin: 150, qtyMax: 150, unit: 'g' },
        ],
        note: 'ou moitie-moitie',
      },
      {
        id: 'lunch-dairy-1',
        label: 'Produit laitier',
        required: true,
        alternatives: [
          {
            category: 'produit_laitier',
            label: 'Produit laitier',
            qtyMin: 1,
            qtyMax: 1,
            unit: 'portion',
          },
          { category: 'fromage', label: 'Fromage', qtyMin: 1, qtyMax: 1, unit: 'portion' },
          {
            category: 'fruits_a_coque',
            label: 'Fruits a coque',
            qtyMin: 10,
            qtyMax: 10,
            unit: 'piece',
          },
        ],
      },
      {
        id: 'lunch-dairy-2',
        label: 'Produit laitier (2)',
        required: true,
        alternatives: [
          {
            category: 'produit_laitier',
            label: 'Produit laitier',
            qtyMin: 1,
            qtyMax: 1,
            unit: 'portion',
          },
          { category: 'fromage', label: 'Fromage', qtyMin: 1, qtyMax: 1, unit: 'portion' },
          {
            category: 'fruits_a_coque',
            label: 'Fruits a coque',
            qtyMin: 10,
            qtyMax: 10,
            unit: 'piece',
          },
        ],
      },
      {
        id: 'lunch-fruit',
        label: 'Fruit',
        required: true,
        alternatives: [
          { category: 'fruit', label: 'Fruit', qtyMin: 1, qtyMax: 1, unit: 'portion' },
        ],
      },
    ],
    dinner: [
      {
        id: 'dinner-vegetables',
        label: 'Legumes',
        required: true,
        alternatives: [
          {
            category: 'legumes',
            label: 'Legumes crus et/ou cuits',
            qtyMin: 100,
            qtyMax: 300,
            unit: 'g',
          },
        ],
      },
      {
        id: 'dinner-protein',
        label: 'Proteine',
        required: true,
        alternatives: [
          { category: 'viande', label: 'Viande', qtyMin: 100, qtyMax: 150, unit: 'g' },
          { category: 'poisson', label: 'Poisson', qtyMin: 150, qtyMax: 200, unit: 'g' },
          { category: 'oeuf', label: 'Oeufs', qtyMin: 2, qtyMax: 2, unit: 'piece' },
          {
            category: 'legumineuse',
            label: 'Legumineuses / quinoa',
            qtyMin: 150,
            qtyMax: 200,
            unit: 'g',
          },
        ],
      },
      {
        id: 'dinner-starch',
        label: 'Feculents',
        required: true,
        alternatives: [
          {
            category: 'feculent',
            label: 'Feculents cuits',
            qtyMin: 300,
            qtyMax: 300,
            unit: 'g',
            note: '10 c.a.s cuits',
          },
          { category: 'pain', label: 'Pain', qtyMin: 150, qtyMax: 150, unit: 'g' },
        ],
        note: 'ou moitie-moitie',
      },
      {
        id: 'dinner-dairy',
        label: 'Produit laitier',
        required: true,
        alternatives: [
          {
            category: 'produit_laitier',
            label: 'Produit laitier',
            qtyMin: 1,
            qtyMax: 1,
            unit: 'portion',
          },
          { category: 'fromage', label: 'Fromage', qtyMin: 1, qtyMax: 1, unit: 'portion' },
          {
            category: 'fruits_a_coque',
            label: 'Fruits a coque',
            qtyMin: 10,
            qtyMax: 10,
            unit: 'piece',
          },
        ],
      },
      {
        id: 'dinner-fruit',
        label: 'Fruit',
        required: true,
        alternatives: [
          { category: 'fruit', label: 'Fruit', qtyMin: 1, qtyMax: 1, unit: 'portion' },
        ],
      },
    ],
  },
  dailyRules: [
    {
      id: 'daily-fats',
      label: 'Matieres grasses',
      required: true,
      alternatives: [
        {
          category: 'matiere_grasse',
          label: 'Huile (ou equivalent)',
          qtyMin: 2,
          qtyMax: 3,
          unit: 'c.a.s',
        },
      ],
      note: 'a repartir sur la journee',
    },
    {
      id: 'daily-sugars',
      label: 'Sucres ajoutes',
      required: false,
      alternatives: [
        {
          category: 'sucre',
          label: 'Confiture / miel / sucre',
          qtyMin: 2,
          qtyMax: 2,
          unit: 'c.a.c',
        },
      ],
      note: 'environ par jour',
    },
  ],
  note: null,
};

// ============================================================================
// Profil dietetique par membre (Phase 5.5)
// ============================================================================

/**
 * Regimes alimentaires reconnus. Code-aligned avec les diet_tags des recipes.
 */
export const RegimeSchema = z.enum([
  'vegetarian',
  'vegan',
  'pescatarian',
  'gluten_free',
  'lactose_free',
  'halal',
  'kosher',
  'low_carb',
  'high_protein',
]);
export type Regime = z.infer<typeof RegimeSchema>;

/**
 * Objectifs personnels orientant la generation de recettes/planning.
 */
export const GoalSchema = z.enum([
  'weight_loss',
  'weight_gain',
  'muscle_gain',
  'maintenance',
  'health_improvement',
]);
export type Goal = z.infer<typeof GoalSchema>;

/**
 * Profil dietetique d'un user dans un foyer. Chaque membre authentifie
 * a son propre profil. Au moment de generer un repas, on agrege les
 * profils des membres presents (qty additionnees, regimes/allergies en union).
 */
export const UserDietPlanSchema = z.object({
  id: UuidSchema,
  userId: UuidSchema,
  /** email du user (uniquement renvoye dans list_household_diet_plans). */
  userEmail: z.string().email().nullable().optional(),
  householdId: UuidSchema,
  dietPlan: DietPlanSchema,
  regimes: z.array(RegimeSchema).default([]),
  /** Allergies texte libre, lowercase ('arachide', 'lactose', ...). */
  allergies: z.array(z.string().min(1).max(50)).default([]),
  goals: z.array(GoalSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type UserDietPlan = z.infer<typeof UserDietPlanSchema>;

export const UpsertUserDietPlanInputSchema = z.object({
  householdId: UuidSchema,
  dietPlan: DietPlanSchema,
  regimes: z.array(RegimeSchema).default([]),
  allergies: z.array(z.string().min(1).max(50)).default([]),
  goals: z.array(GoalSchema).default([]),
});
export type UpsertUserDietPlanInput = z.infer<typeof UpsertUserDietPlanInputSchema>;

export const HouseholdDietPlansResponseSchema = z.object({
  items: z.array(UserDietPlanSchema),
});
export type HouseholdDietPlansResponse = z.infer<typeof HouseholdDietPlansResponseSchema>;

export const MealPlanSchema = z.object({
  id: UuidSchema,
  householdId: UuidSchema,
  name: z.string().min(1).max(100),
  isDefault: z.boolean(),
  slotConfig: SlotConfigSchema,
  nutritionTargets: DailyTargetsSchema.nullable(),
  varietyRules: VarietyRulesSchema.nullable(),
  dietPlan: DietPlanSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MealPlan = z.infer<typeof MealPlanSchema>;

export const UpsertMealPlanInputSchema = z.object({
  householdId: UuidSchema,
  mealPlanId: UuidSchema.nullable().optional(),
  name: z.string().min(1).max(100).default('Semaine type'),
  slotConfig: SlotConfigSchema,
  nutritionTargets: DailyTargetsSchema.nullable().optional(),
  varietyRules: VarietyRulesSchema.nullable().optional(),
  dietPlan: DietPlanSchema.nullable().optional(),
});
export type UpsertMealPlanInput = z.infer<typeof UpsertMealPlanInputSchema>;

/**
 * Planning : un planning genere pour une periode.
 */
export const PlannedMealSchema = z.object({
  id: UuidSchema,
  /**
   * Foyer auquel ce repas appartient. Depuis la refonte calendrier libre,
   * les meals ne sont plus regroupes par 'planning' (entite supprimee) et
   * sont rattaches directement au foyer.
   */
  householdId: UuidSchema,
  date: z.string(), // YYYY-MM-DD
  slotKey: MealSlotKeySchema,
  recipeId: UuidSchema.nullable(),
  customTitle: z.string().nullable(),
  servings: z.number().int().positive(),
  diners: z.array(UuidSchema),
  locked: z.boolean(),
  notes: z.string().nullable(),
  position: z.number().int(),
  /**
   * Nombre de repas (au sens "principaux" : dejeuner + diner) couverts par
   * ce repas, en comptant celui-ci. Defaut 1.
   *
   * Exemple : un diner avec coversMeals=2 couvre :
   *   - le diner du jour (current)
   *   - le prochain repas principal (typiquement dejeuner du lendemain)
   *
   * Les slots petit-dej / gouter sont sautes lors du calcul des slots
   * couverts. Cf. helper findCoveredSlots() dans @mealendar/shared.
   */
  coversMeals: z.number().int().min(1).max(7).default(1),
});
export type PlannedMeal = z.infer<typeof PlannedMealSchema>;

/**
 * Reponse "tous les meals d'un foyer dans une fenetre [dateFrom, dateTo]".
 * Remplace l'ancienne structure PlanningWithMeals (qui dependait d'une entite
 * planning supprimee).
 */
export const MealsRangeSchema = z.object({
  householdId: UuidSchema,
  dateFrom: z.string(), // YYYY-MM-DD
  dateTo: z.string(), // YYYY-MM-DD
  meals: z.array(PlannedMealSchema),
});
export type MealsRange = z.infer<typeof MealsRangeSchema>;

export const PlannedMealInputSchema = z.object({
  date: z.string(),
  slotKey: MealSlotKeySchema,
  recipeId: UuidSchema.nullable().optional(),
  customTitle: z.string().min(1).max(200).nullable().optional(),
  servings: z.number().int().positive().default(4),
  diners: z.array(UuidSchema).default([]),
  locked: z.boolean().default(false),
  notes: z.string().max(500).nullable().optional(),
  position: z.number().int().nonnegative().default(0),
  coversMeals: z.number().int().min(1).max(7).default(1),
});
export type PlannedMealInput = z.infer<typeof PlannedMealInputSchema>;

export const SetMealsRangeInputSchema = z.object({
  /** Date de debut de la fenetre (inclusive) YYYY-MM-DD */
  dateFrom: z.string(),
  /** Date de fin de la fenetre (inclusive) YYYY-MM-DD */
  dateTo: z.string(),
  /** Meals a placer dans la fenetre. Toutes les dates DOIVENT etre dans [dateFrom, dateTo]. */
  meals: z.array(PlannedMealInputSchema),
  /** Si true, les meals existants avec locked=true dans la fenetre sont conserves. */
  keepLocked: z.boolean().default(true),
});
export type SetMealsRangeInput = z.infer<typeof SetMealsRangeInputSchema>;

export const UpdatePlannedMealInputSchema = z.object({
  recipeId: UuidSchema.nullable().optional(),
  customTitle: z.string().nullable().optional(),
  servings: z.number().int().positive().optional(),
  diners: z.array(UuidSchema).optional(),
  locked: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  coversMeals: z.number().int().min(1).max(7).optional(),
});
export type UpdatePlannedMealInput = z.infer<typeof UpdatePlannedMealInputSchema>;

/**
 * Liste de courses agregee depuis un planning.
 */
export const ShoppingItemSchema = z.object({
  ingredientName: z.string(),
  unit: z.string().nullable(),
  totalQuantity: z.number().nullable(),
  recipeIds: z.array(UuidSchema),
});
export type ShoppingItem = z.infer<typeof ShoppingItemSchema>;

export const ShoppingListResponseSchema = z.object({
  householdId: UuidSchema,
  dateFrom: z.string(),
  dateTo: z.string(),
  items: z.array(ShoppingItemSchema),
});
export type ShoppingListResponse = z.infer<typeof ShoppingListResponseSchema>;

// ============================================================================
// LLM : generation de recettes
// ============================================================================

/**
 * Input pour POST /api/llm/generate-recipe.
 * Tous les champs sont optionnels sauf l'idee/prompt principale.
 */
export const GenerateRecipeInputSchema = z.object({
  householdId: UuidSchema,
  /** description libre de l'idee : "diner italien rapide", "tartiflette legere", ... */
  prompt: z.string().min(3).max(500).trim(),
  /** Optionnel : contraintes complementaires */
  servings: z.number().int().positive().max(20).optional(),
  maxKcal: z.number().int().positive().max(3000).optional(),
  dietTags: z.array(z.string()).default([]),
  mealSlots: z.array(MealSlotKeySchema).default([]),
  /** Liste d'allergenes a eviter (codes Open Food Facts ou texte libre) */
  avoidAllergens: z.array(z.string()).default([]),
  /** Si true, persiste la recette en DB et retourne son id ; sinon juste preview */
  save: z.boolean().default(true),
  /**
   * Composants attendus du plan alimentaire pour ce repas.
   * Si fournis, le LLM ajustera les quantites et alternatives en consequence.
   */
  dietComponents: z.array(DietComponentSchema).optional(),
});
export type GenerateRecipeInput = z.infer<typeof GenerateRecipeInputSchema>;

/**
 * Schema strict de la reponse attendue du LLM (JSON mode).
 * On le garde simple pour maximiser le taux de succes sur Flash / Groq.
 */
export const LlmRecipeIngredientSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  notes: z.string().nullable().optional(),
});
export type LlmRecipeIngredient = z.infer<typeof LlmRecipeIngredientSchema>;

/**
 * Step minimal pour le LLM : pas d'id (on en genere un cote serveur).
 */
export const LlmRecipeStepSchema = z.object({
  text: z.string().min(1).max(2000),
  durationMin: z.number().int().nonnegative().nullable().optional(),
});
export type LlmRecipeStep = z.infer<typeof LlmRecipeStepSchema>;

export const LlmRecipeDraftSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  servings: z.number().int().positive().max(20).default(4),
  prepTimeMin: z.number().int().nonnegative().nullable().optional(),
  cookTimeMin: z.number().int().nonnegative().nullable().optional(),
  steps: z.array(LlmRecipeStepSchema).min(1).max(40),
  dietTags: z.array(z.string()).default([]),
  mealSlots: z.array(z.string()).default([]),
  ingredients: z.array(LlmRecipeIngredientSchema).min(1),
});
export type LlmRecipeDraft = z.infer<typeof LlmRecipeDraftSchema>;

export const GenerateRecipeResponseSchema = z.object({
  /** La recette draft retournee par le LLM (apres validation Zod). */
  draft: LlmRecipeDraftSchema,
  /** Si save=true, l'id de la recette persistee. */
  recipeId: UuidSchema.nullable(),
  /** Indications de provenance pour l'UX */
  meta: z.object({
    model: z.string(),
    cacheHit: z.boolean(),
    generatedAt: z.string().datetime(),
  }),
});
export type GenerateRecipeResponse = z.infer<typeof GenerateRecipeResponseSchema>;

/**
 * Quota response (GET /api/llm/quota)
 */
export const LlmQuotaResponseSchema = z.object({
  /** Limite de generations LLM par jour pour ce user (config serveur). */
  dailyLimit: z.number().int().nonnegative(),
  /** Generations consommees dans la fenetre 24h (cache hits exclus). */
  used24h: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
});
export type LlmQuotaResponse = z.infer<typeof LlmQuotaResponseSchema>;

// ============================================================================
// Generation IA d'un planning complet (LLM full-planning)
// ============================================================================

/**
 * Input : on demande au LLM de remplir une fenetre [dateFrom, dateTo] avec
 * des meals, en piochant parmi les recettes deja en bibliotheque (ou en en
 * creant de nouvelles selon `mode`).
 *
 * Le serveur enrichit le prompt avec :
 *  - le slot config (jours x slots) du plan-type du foyer
 *  - le diet plan (composants requis par slot, agrege multi-membres)
 *  - les recettes existantes (titre + slots cibles + tags + servings)
 *  - les meals deja locked dans la fenetre (pour ne pas les ecraser)
 *  - les regles de variete (minDaysBetweenSameRecipe)
 */
export const GeneratePlanningInputSchema = z.object({
  householdId: UuidSchema,
  /** Date de debut de la fenetre (inclusive) YYYY-MM-DD */
  dateFrom: z.string(),
  /** Date de fin de la fenetre (inclusive) YYYY-MM-DD */
  dateTo: z.string(),
  /** Si true on conserve les meals deja locked. Defaut true. */
  keepLocked: z.boolean().default(true),
  /** Texte libre additionnel pour orienter l'IA (ex : "semaine plutot mediterraneenne"). */
  hint: z.string().max(500).optional(),
});
export type GeneratePlanningInput = z.infer<typeof GeneratePlanningInputSchema>;

/**
 * Sortie LLM : un meal par (date, slotKey). Le LLM reference une recette
 * par son `recipeId` (UUID present dans la liste fournie en input).
 * Si le LLM estime qu'aucune recette ne convient, recipeId = null + reason.
 */
export const LlmPlanningMealSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  slotKey: MealSlotKeySchema,
  recipeId: UuidSchema.nullable(),
  /**
   * Nombre de repas principaux (dejeuner + diner) couverts par ce repas,
   * en comptant celui-ci. 1 = juste ce repas. 2 = ce repas + le prochain
   * repas principal. Plage 1..3.
   */
  coversMeals: z.number().int().min(1).max(3).default(1),
  /** Justification courte (debug + UX si null). */
  reason: z.string().max(200).optional(),
});
export type LlmPlanningMeal = z.infer<typeof LlmPlanningMealSchema>;

export const LlmPlanningOutputSchema = z.object({
  meals: z.array(LlmPlanningMealSchema),
  /** Resume textuel court (1-2 phrases) pour afficher en UI. */
  summary: z.string().max(500).optional(),
});
export type LlmPlanningOutput = z.infer<typeof LlmPlanningOutputSchema>;

export const GeneratePlanningResponseSchema = z.object({
  output: LlmPlanningOutputSchema,
  /** Nb de slots remplis (recipeId != null) */
  filled: z.number().int().nonnegative(),
  /** Nb de slots laisses vides (recipeId == null) */
  skipped: z.number().int().nonnegative(),
  meta: z.object({
    model: z.string(),
    cacheHit: z.boolean(),
    generatedAt: z.string().datetime(),
  }),
});
export type GeneratePlanningResponse = z.infer<typeof GeneratePlanningResponseSchema>;

// ============================================================================
// Import recette depuis URL
// ============================================================================
export const ImportRecipeInputSchema = z.object({
  householdId: UuidSchema,
  url: z.string().url(),
  /** Si true, persiste la recette en DB et retourne son id ; sinon juste preview */
  save: z.boolean().default(true),
});
export type ImportRecipeInput = z.infer<typeof ImportRecipeInputSchema>;

export const ImportRecipeResponseSchema = z.object({
  draft: LlmRecipeDraftSchema,
  recipeId: UuidSchema.nullable(),
  sourceUrl: z.string().url(),
});
export type ImportRecipeResponse = z.infer<typeof ImportRecipeResponseSchema>;

// ============================================================================
// Upload de photos de recettes
// ============================================================================

export const RecipePhotoUploadInputSchema = z.object({
  recipeId: UuidSchema,
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** Extension du fichier (jpg, png, webp) - utilisee pour construire le chemin */
  ext: z.string().regex(/^[a-z0-9]{2,5}$/),
});
export type RecipePhotoUploadInput = z.infer<typeof RecipePhotoUploadInputSchema>;

export const RecipePhotoUploadResponseSchema = z.object({
  /** URL signee POST/PUT pour uploader directement vers Supabase Storage */
  signedUrl: z.string().url(),
  /** Le chemin (path) dans le bucket : <household>/<recipe>/<file> */
  path: z.string(),
  /** Le token a passer dans le body de l'upload (Supabase Storage spec) */
  token: z.string().optional(),
  /** URL publique finale (a stocker dans recipes.image_url) */
  publicUrl: z.string().url(),
});
export type RecipePhotoUploadResponse = z.infer<typeof RecipePhotoUploadResponseSchema>;

// ============================================================================
// Push notifications (Phase 5.4)
// ============================================================================

export const PushPlatformSchema = z.enum(['ios', 'android']);
export type PushPlatform = z.infer<typeof PushPlatformSchema>;

/**
 * Token Expo Push : "ExponentPushToken[xxxxxxxxxxxxxxxxx]"
 */
export const RegisterPushTokenInputSchema = z.object({
  token: z.string().min(10).max(200),
  platform: PushPlatformSchema,
});
export type RegisterPushTokenInput = z.infer<typeof RegisterPushTokenInputSchema>;

export const SetPushEnabledInputSchema = z.object({
  enabled: z.boolean(),
});
export type SetPushEnabledInput = z.infer<typeof SetPushEnabledInputSchema>;

// ============================================================================
// Agregation des profils dietetiques (Phase 5.5)
// ============================================================================

/**
 * Resultat de l'agregation : les contraintes du repas pour N membres presents
 * sur un slot donne.
 *
 * - `components` : liste des composants attendus avec qty cumulee (sum des
 *   qtyMin/qtyMax de chaque membre pour ce label).
 * - `regimes` : union des regimes des membres presents (si un seul est vegan,
 *   tout le repas l'est).
 * - `allergies` : union des allergies.
 */
export type AggregatedSlotDiet = {
  components: DietComponent[];
  regimes: Regime[];
  allergies: string[];
  /** Indique combien de membres ont contribue (utile pour le servings). */
  memberCount: number;
};

/**
 * Agrege les profils des membres presents pour un slot donne.
 *
 * - Groupe les composants par `label` (case-insensitive, trim) ;
 * - Pour chaque groupe, additionne qtyMin et qtyMax sur les alternatives de
 *   meme `category`. Si les membres ont des alternatives differentes (ex
 *   viande pour l'un, poisson pour l'autre), on garde toutes les alternatives
 *   distinctes (par category).
 * - Le flag `required` est gardé true si AU MOINS un membre l'exige.
 *
 * @param plans Profils des membres presents (filtres en amont par diners).
 * @param slotKey 'breakfast' | 'lunch' | 'snack' | 'dinner' | ...
 */
export function aggregateDietPlansForSlot(
  plans: UserDietPlan[],
  slotKey: string,
): AggregatedSlotDiet {
  const componentsByLabel = new Map<
    string,
    {
      label: string;
      required: boolean;
      altsByCategory: Map<DietCategory, DietAlternative>;
    }
  >();

  for (const p of plans) {
    const slot = p.dietPlan.slots[slotKey] ?? [];
    for (const comp of slot) {
      const key = comp.label.trim().toLowerCase();
      const entry = componentsByLabel.get(key) ?? {
        label: comp.label,
        required: false,
        altsByCategory: new Map<DietCategory, DietAlternative>(),
      };
      if (comp.required) entry.required = true;

      for (const alt of comp.alternatives) {
        const existing = entry.altsByCategory.get(alt.category);
        if (!existing) {
          entry.altsByCategory.set(alt.category, { ...alt });
        } else {
          // Additionne min/max si compatibles (meme unite)
          const sameUnit = (existing.unit ?? null) === (alt.unit ?? null);
          if (sameUnit) {
            existing.qtyMin = sumNullable(existing.qtyMin, alt.qtyMin);
            existing.qtyMax = sumNullable(existing.qtyMax, alt.qtyMax);
          }
          // Sinon on garde l'existant (pas de conversion auto entre unites)
        }
      }
      componentsByLabel.set(key, entry);
    }
  }

  const components: DietComponent[] = [];
  for (const [, entry] of componentsByLabel) {
    components.push({
      id: `agg-${entry.label.toLowerCase().replace(/\s+/g, '-')}`,
      label: entry.label,
      required: entry.required,
      alternatives: [...entry.altsByCategory.values()],
      note: null,
    });
  }

  // Union des regimes / allergies
  const regimesSet = new Set<Regime>();
  const allergiesSet = new Set<string>();
  for (const p of plans) {
    for (const r of p.regimes) regimesSet.add(r);
    for (const a of p.allergies) allergiesSet.add(a.toLowerCase());
  }

  return {
    components,
    regimes: [...regimesSet],
    allergies: [...allergiesSet],
    memberCount: plans.length,
  };
}

function sumNullable(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

// ============================================================================
// Helper coversMeals : calcule les slots couverts par un repas multi-meals
// ============================================================================

/**
 * Un slot dans le planning, identifie par sa date et son slotKey.
 */
export type SlotRef = {
  date: string; // YYYY-MM-DD
  slotKey: string;
};

/**
 * Etant donne :
 *  - un sourceMeal a (date, slotKey) avec coversMeals = N
 *  - le slotConfig du foyer (jours de la semaine -> liste de slots)
 *  - une fenetre maximale de scan (en jours)
 *
 * Renvoie les (N - 1) slots COUVERTS par ce repas (excluant le source lui-meme).
 *
 * Logique :
 *  1. On parcourt les jours suivants (source date inclus) dans l'ordre.
 *  2. Pour chaque jour, on prend les slots configures de ce jour dans l'ordre.
 *  3. On ne compte que les slots "principaux" (lunch, dinner) car les
 *     petits-dej / gouters ne sont pas des "restes" plausibles.
 *  4. On saute le slot source (meme date + meme slot).
 *  5. On stoppe quand on a atteint (N - 1) slots couverts.
 *
 * Exemples concrets (avec slotConfig standard breakfast/lunch/snack/dinner) :
 *   - sourceSlot=dinner du Lundi, coversMeals=2 -> couvre lunch Mardi
 *   - sourceSlot=dinner du Lundi, coversMeals=3 -> couvre lunch Mardi + dinner Mardi
 *   - sourceSlot=lunch du Lundi, coversMeals=2 -> couvre dinner Lundi
 *   - sourceSlot=lunch du Lundi, coversMeals=3 -> couvre dinner Lundi + lunch Mardi
 *
 * Les retours sont au format YYYY-MM-DD (la fonction ne fait pas d'ajustement
 * timezone, traite la date comme un jour calendaire).
 */
export function findCoveredSlots(opts: {
  sourceDate: string;
  sourceSlotKey: string;
  coversMeals: number;
  slotConfig: Record<string, { key: string }[]>;
  /** Nb max de jours a scanner devant pour trouver les slots. Defaut 7. */
  maxScanDays?: number;
}): SlotRef[] {
  const { sourceDate, sourceSlotKey, coversMeals, slotConfig } = opts;
  const maxScanDays = opts.maxScanDays ?? 7;
  if (coversMeals <= 1) return [];

  const slotsToFind = coversMeals - 1; // Le source compte deja
  const out: SlotRef[] = [];
  let foundSource = false;

  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  for (let dayOffset = 0; dayOffset <= maxScanDays && out.length < slotsToFind; dayOffset++) {
    const d = new Date(`${sourceDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dayOffset);
    const dateIso = d.toISOString().slice(0, 10);
    const wd = weekdays[d.getUTCDay()] ?? 'monday';
    const slotsForDay = slotConfig[wd] ?? [];

    for (const slot of slotsForDay) {
      // Saute jusqu'a depasser le slot source
      if (!foundSource) {
        if (dateIso === sourceDate && slot.key === sourceSlotKey) {
          foundSource = true;
        }
        continue;
      }
      // Apres le source, on ne compte que les slots principaux
      if (!isMainMealSlot(slot.key)) continue;
      out.push({ date: dateIso, slotKey: slot.key });
      if (out.length >= slotsToFind) break;
    }
  }

  return out;
}
