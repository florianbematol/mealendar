import { DietComponentChips } from '@/components/DietComponentChips';
import { GenerateRecipeModal } from '@/components/GenerateRecipeModal';
import { useHouseholdDetail } from '@/hooks/useHouseholds';
import {
  useDeletePlanning,
  useGeneratePlanningWithLlm,
  useMealPlan,
  usePlanning,
  useSetPlanningMeals,
  useUpdatePlannedMeal,
} from '@/hooks/usePlannings';
import { useRecipes } from '@/hooks/useRecipes';
import { ApiError, fetchPlanningIcs } from '@/lib/api';
import { WEEKDAY_LABELS, addDays, fromIsoDate, rangeDates, weekdayOf } from '@/lib/dates';
import { haptics } from '@/lib/haptics';
import { generatePlanningMeals } from '@/lib/planningGenerator';
import { useActiveHousehold } from '@/stores/activeHousehold';
import type { DietComponent, PlannedMeal, RecipeListItem } from '@mealendar/shared';
import * as FileSystem from 'expo-file-system';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useLayoutEffect, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  Dialog,
  IconButton,
  Portal,
  Surface,
  Text,
  TouchableRipple,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

const SLOT_LABELS: Record<string, string> = {
  breakfast: 'Petit-dej',
  lunch: 'Dejeuner',
  snack: 'Gouter',
  dinner: 'Diner',
};

export default function PlanningDetailScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const householdId = useActiveHousehold((s) => s.householdId);

  const planning = usePlanning(id);
  const mealPlan = useMealPlan(householdId);
  const recipes = useRecipes(householdId);
  const household = useHouseholdDetail(householdId);
  const setMeals = useSetPlanningMeals(id ?? '');
  const updateMeal = useUpdatePlannedMeal(id ?? '');
  const deletePlanning = useDeletePlanning();
  const generateLlm = useGeneratePlanningWithLlm(id ?? '');

  /** nb membres actifs du foyer (fallback 4 si pas encore charge) */
  const memberCount = Math.max(1, household.data?.members.length ?? 4);

  const [recipePickerOpen, setRecipePickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<{
    date: string;
    slotKey: string;
  } | null>(null);
  /** valeur courante du stepper coversDays dans le picker (1..3) */
  const [pickerCoversDays, setPickerCoversDays] = useState<number>(1);
  /**
   * Set des user_id concernes par le repas. Vide = tous les membres
   * (comportement par defaut pour ne pas casser l'existant).
   */
  const [pickerDiners, setPickerDiners] = useState<string[]>([]);

  // Generation IA contextuelle pour un slot du planning
  const [iaContext, setIaContext] = useState<{
    date: string;
    slotKey: string;
    components: DietComponent[];
  } | null>(null);

  useLayoutEffect(() => {
    if (!planning.data) return;
    navigation.setOptions({
      title: planning.data.name,
      headerRight: () => (
        <View style={{ flexDirection: 'row' }}>
          <IconButton
            icon="cart-outline"
            size={20}
            onPress={() => router.push(`/(app)/(tabs)/planning/${id}/shopping`)}
          />
          <IconButton icon="calendar-export" size={20} onPress={() => onExportIcs()} />
          <IconButton
            icon="trash-can-outline"
            iconColor={theme.colors.error}
            size={20}
            onPress={() => {
              Alert.alert('Supprimer le planning', 'Cette action est irreversible.', [
                { text: 'Annuler', style: 'cancel' },
                {
                  text: 'Supprimer',
                  style: 'destructive',
                  onPress: async () => {
                    if (!planning.data) return;
                    try {
                      await deletePlanning.mutateAsync({
                        id: planning.data.id,
                        householdId: planning.data.householdId,
                      });
                      router.replace('/(app)/(tabs)/planning');
                    } catch (e) {
                      Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
                    }
                  },
                },
              ]);
            }}
          />
        </View>
      ),
    });
  }, [navigation, planning.data, id, theme.colors.error, deletePlanning]);

  const dates = useMemo(
    () => (planning.data ? rangeDates(planning.data.startDate, planning.data.endDate) : []),
    [planning.data],
  );

  const mealsByDateSlot = useMemo(() => {
    const map = new Map<string, PlannedMeal[]>();
    if (!planning.data) return map;
    for (const m of planning.data.meals) {
      const k = `${m.date}|${m.slotKey}`;
      const arr = map.get(k) ?? [];
      arr.push(m);
      map.set(k, arr);
    }
    return map;
  }, [planning.data]);

  /**
   * Map des slots qui sont COUVERTS par un meal multi-jours posé un ou
   * plusieurs jours avant. Cle = `${date}|${slotKey}`, valeur = meal source.
   *
   * Ex : meal du 2026-01-02 dinner avec coversDays=2
   *  -> coveredByMap['2026-01-03|dinner'] = ce meal
   */
  const coveredByMap = useMemo(() => {
    const map = new Map<string, PlannedMeal>();
    if (!planning.data) return map;
    for (const m of planning.data.meals) {
      const cd = m.coversDays ?? 1;
      if (cd <= 1) continue;
      for (let i = 1; i < cd; i++) {
        map.set(`${addDays(m.date, i)}|${m.slotKey}`, m);
      }
    }
    return map;
  }, [planning.data]);

  const recipesById = useMemo(() => {
    const map = new Map<string, RecipeListItem>();
    for (const r of recipes.data?.items ?? []) map.set(r.id, r);
    return map;
  }, [recipes.data]);

  const onGenerate = async () => {
    if (!planning.data || !mealPlan.data) {
      Alert.alert(
        'Plan-type requis',
        "Configurez d'abord votre plan-type pour generer un planning.",
        [
          { text: 'Plus tard', style: 'cancel' },
          {
            text: 'Configurer',
            onPress: () => router.push('/(app)/(tabs)/planning/meal-plan'),
          },
        ],
      );
      return;
    }
    if ((recipes.data?.items.length ?? 0) === 0) {
      Alert.alert(
        'Aucune recette',
        'Ajoutez au moins quelques recettes a votre bibliotheque pour pouvoir generer un planning.',
      );
      return;
    }
    const generated = generatePlanningMeals({
      startDate: planning.data.startDate,
      endDate: planning.data.endDate,
      slotConfig: mealPlan.data.slotConfig,
      recipes: recipes.data?.items ?? [],
      existingMeals: planning.data.meals,
      varietyRules: mealPlan.data.varietyRules,
      defaultServings: memberCount,
    });
    try {
      await setMeals.mutateAsync({ meals: generated, keepLocked: true });
      haptics.success();
    } catch (e) {
      haptics.error();
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  const onClear = async () => {
    if (!planning.data) return;
    Alert.alert('Tout effacer', 'Supprime tous les repas (sauf ceux verrouilles).', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Effacer',
        style: 'destructive',
        onPress: async () => {
          try {
            await setMeals.mutateAsync({ meals: [], keepLocked: true });
          } catch (e) {
            Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
          }
        },
      },
    ]);
  };

  /**
   * Generation IA full-planning : un seul appel LLM remplit toute la semaine
   * en piochant parmi les recettes existantes du foyer.
   * Consomme 1 unite de quota LLM (idem creation d'1 recette IA).
   */
  const onGenerateLlm = async () => {
    if (!planning.data || !mealPlan.data) {
      Alert.alert('Plan-type requis', "Configurez d'abord votre plan-type.");
      return;
    }
    if ((recipes.data?.items.length ?? 0) === 0) {
      Alert.alert(
        'Aucune recette',
        "Ajoutez au moins quelques recettes a votre bibliotheque avant de demander a l'IA de planifier.",
      );
      return;
    }
    Alert.alert(
      "Generer avec l'IA ?",
      "L'IA choisira les recettes les plus adaptees a vos contraintes (plan alimentaire, variete, slots). Consomme 1 unite de quota LLM.",
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Generer',
          onPress: async () => {
            try {
              const res = await generateLlm.mutateAsync({
                planningId: planning.data?.id ?? '',
                keepLocked: true,
              });
              haptics.success();
              const skippedTxt =
                res.skipped > 0
                  ? ` ${res.skipped} slot${res.skipped > 1 ? 's' : ''} non rempli${res.skipped > 1 ? 's' : ''}.`
                  : '';
              Alert.alert(
                'Planning genere',
                `${res.filled} repas planifie${res.filled > 1 ? 's' : ''}.${skippedTxt}`,
              );
            } catch (e) {
              haptics.error();
              if (e instanceof ApiError) {
                Alert.alert('Erreur IA', `${e.status} - ${e.message}`);
              } else {
                Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
              }
            }
          },
        },
      ],
    );
  };

  const onPickRecipe = async (recipeId: string) => {
    if (!pickerTarget || !planning.data) return;
    const existing = mealsByDateSlot.get(`${pickerTarget.date}|${pickerTarget.slotKey}`)?.[0];
    const coversDays = Math.min(3, Math.max(1, pickerCoversDays));
    // Effective diner count : si tableau vide -> tout le monde
    const effectiveDinerCount = pickerDiners.length > 0 ? pickerDiners.length : memberCount;
    const servings = effectiveDinerCount * coversDays;

    if (existing) {
      // patch existant
      try {
        await updateMeal.mutateAsync({
          mealId: existing.id,
          input: {
            recipeId,
            customTitle: null,
            coversDays,
            servings,
            diners: pickerDiners,
          },
        });
      } catch (e) {
        Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
      }
    } else {
      // crée un meal en passant par setPlanningMeals avec keepLocked + ajout
      const others = planning.data.meals.map((m) => ({
        date: m.date,
        slotKey: m.slotKey,
        recipeId: m.recipeId,
        customTitle: m.customTitle,
        servings: m.servings,
        diners: m.diners,
        locked: m.locked,
        notes: m.notes,
        position: m.position,
        coversDays: m.coversDays,
      }));
      try {
        await setMeals.mutateAsync({
          keepLocked: false, // on ecrase tout, on a deja les autres dans `others`
          meals: [
            ...others,
            {
              date: pickerTarget.date,
              slotKey: pickerTarget.slotKey,
              recipeId,
              servings,
              diners: pickerDiners,
              locked: false,
              position: 0,
              coversDays,
            },
          ],
        });
      } catch (e) {
        Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
      }
    }
    setRecipePickerOpen(false);
    setPickerTarget(null);
    setPickerCoversDays(1);
    setPickerDiners([]);
  };

  const onRemoveMeal = async (meal: PlannedMeal) => {
    if (!planning.data) return;
    const remaining = planning.data.meals
      .filter((m) => m.id !== meal.id)
      .map((m) => ({
        date: m.date,
        slotKey: m.slotKey,
        recipeId: m.recipeId,
        customTitle: m.customTitle,
        servings: m.servings,
        diners: m.diners,
        locked: m.locked,
        notes: m.notes,
        position: m.position,
        coversDays: m.coversDays,
      }));
    try {
      await setMeals.mutateAsync({ meals: remaining, keepLocked: false });
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  const onToggleLock = async (meal: PlannedMeal) => {
    haptics.light();
    try {
      await updateMeal.mutateAsync({
        mealId: meal.id,
        input: { locked: !meal.locked },
      });
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  /**
   * L'utilisateur a tape sur un slot couvert par un meal multi-jours.
   * On lui propose soit de detacher (reduire coversDays du meal source pour
   * liberer ce slot), soit d'annuler.
   */
  const onPressCoveredSlot = (
    sourceMeal: PlannedMeal,
    targetDate: string,
    _targetSlotKey: string,
  ) => {
    const sourceWd = WEEKDAY_LABELS[weekdayOf(sourceMeal.date)];
    const sourceDateLabel = `${String(fromIsoDate(sourceMeal.date).getDate()).padStart(2, '0')}/${String(fromIsoDate(sourceMeal.date).getMonth() + 1).padStart(2, '0')}`;
    // Nb de jours entre la source et la cible (1 = lendemain, etc.)
    const daysAfter = Math.round(
      (Date.parse(targetDate) - Date.parse(sourceMeal.date)) / 86_400_000,
    );
    Alert.alert(
      'Repas couvert',
      `Ce creneau est couvert par le repas du ${sourceWd} ${sourceDateLabel}.`,
      [
        { text: 'OK', style: 'cancel' },
        {
          text: 'Liberer ce creneau',
          onPress: async () => {
            // On reduit le coversDays du meal source pour ne plus couvrir
            // jusqu'a la cible. Si la cible est J+1 (daysAfter=1) -> coversDays=1.
            const newCoversDays = Math.max(1, daysAfter);
            const newServings =
              sourceMeal.servings > 0 && sourceMeal.coversDays > 0
                ? Math.round((sourceMeal.servings / sourceMeal.coversDays) * newCoversDays)
                : sourceMeal.servings;
            try {
              await updateMeal.mutateAsync({
                mealId: sourceMeal.id,
                input: { coversDays: newCoversDays, servings: newServings },
              });
            } catch (e) {
              Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
            }
          },
        },
      ],
    );
  };

  /**
   * Exporte le planning en .ics et lance le partage natif.
   */
  const onExportIcs = async () => {
    if (!planning.data) return;
    try {
      const ics = await fetchPlanningIcs(planning.data.id);
      const file = new FileSystem.File(FileSystem.Paths.cache, `planning-${planning.data.id}.ics`);
      if (file.exists) {
        file.delete();
      }
      file.create();
      file.write(ics);
      const ok = await Sharing.isAvailableAsync();
      if (!ok) {
        Alert.alert(
          'Partage indisponible',
          "Le fichier a ete cree mais le partage natif n'est pas dispo.",
        );
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/calendar',
        dialogTitle: 'Exporter vers calendrier',
        UTI: 'public.calendar-event',
      });
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  /**
   * Au succes d'une generation IA contextuelle, on attache la recette creee au
   * planned_meal du slot. Si un meal existe deja a cette date+slot, on le patch ;
   * sinon on l'ajoute via setPlanningMeals avec keepLocked=false (en preservant les autres).
   */
  const onIaSuccess = async (recipeId: string | null) => {
    const ctx = iaContext;
    setIaContext(null);
    if (!recipeId || !ctx || !planning.data) return;

    const existing = mealsByDateSlot.get(`${ctx.date}|${ctx.slotKey}`)?.[0];
    if (existing) {
      try {
        await updateMeal.mutateAsync({
          mealId: existing.id,
          input: { recipeId, customTitle: null },
        });
      } catch (e) {
        Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
      }
      return;
    }

    const others = planning.data.meals.map((m) => ({
      date: m.date,
      slotKey: m.slotKey,
      recipeId: m.recipeId,
      customTitle: m.customTitle,
      servings: m.servings,
      diners: m.diners,
      locked: m.locked,
      notes: m.notes,
      position: m.position,
      coversDays: m.coversDays,
    }));
    try {
      await setMeals.mutateAsync({
        keepLocked: false,
        meals: [
          ...others,
          {
            date: ctx.date,
            slotKey: ctx.slotKey,
            recipeId,
            servings: memberCount,
            diners: [],
            locked: false,
            position: 0,
            coversDays: 1,
          },
        ],
      });
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  if (planning.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }
  if (planning.isError || !planning.data) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <Text variant="titleMedium">Planning introuvable</Text>
        {planning.error && (
          <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
            {planning.error instanceof ApiError
              ? `${planning.error.status} - ${planning.error.message}`
              : (planning.error as Error).message}
          </Text>
        )}
      </View>
    );
  }

  const slotsForDay = (date: string) => {
    const wd = weekdayOf(date);
    const planSlots = mealPlan.data?.slotConfig[wd] ?? [];
    const slotsFromMeals = (planning.data?.meals ?? [])
      .filter((m) => m.date === date)
      .map((m) => ({ key: m.slotKey }));
    // union par key, preservant l'ordre du plan-type d'abord
    const seen = new Set<string>();
    const out: { key: string }[] = [];
    for (const s of [...planSlots, ...slotsFromMeals]) {
      if (!seen.has(s.key)) {
        seen.add(s.key);
        out.push({ key: s.key });
      }
    }
    return out;
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={[]}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={planning.isFetching && !planning.isPending}
            onRefresh={() => planning.refetch()}
            tintColor={theme.colors.primary}
          />
        }
      >
        <View style={styles.actionsRow}>
          <Button
            mode="contained"
            icon="dice-multiple-outline"
            onPress={onGenerate}
            loading={setMeals.isPending && !generateLlm.isPending}
            disabled={setMeals.isPending || generateLlm.isPending}
            style={styles.flexBtn}
            contentStyle={styles.btnContent}
          >
            Aleatoire
          </Button>
          <Button
            mode="contained-tonal"
            icon="auto-fix"
            onPress={onGenerateLlm}
            loading={generateLlm.isPending}
            disabled={setMeals.isPending || generateLlm.isPending}
            style={styles.flexBtn}
            contentStyle={styles.btnContent}
          >
            IA
          </Button>
          <Button
            mode="outlined"
            icon="delete-sweep-outline"
            onPress={onClear}
            disabled={setMeals.isPending || generateLlm.isPending}
            style={styles.flexBtn}
            contentStyle={styles.btnContent}
          >
            Effacer
          </Button>
        </View>

        {dates.map((date) => {
          const slots = slotsForDay(date);
          const wd = weekdayOf(date);
          return (
            <Surface
              key={date}
              elevation={0}
              style={[styles.dayCard, { backgroundColor: theme.colors.surface }]}
            >
              <View style={styles.dayHeader}>
                <Text variant="titleMedium" style={styles.dayTitle}>
                  {WEEKDAY_LABELS[wd]}
                </Text>
                <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                  {String(fromIsoDate(date).getDate()).padStart(2, '0')}/
                  {String(fromIsoDate(date).getMonth() + 1).padStart(2, '0')}
                </Text>
              </View>

              {slots.length === 0 ? (
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant, fontStyle: 'italic' }}
                >
                  Aucun slot configure (cf. plan-type).
                </Text>
              ) : (
                slots.map((slot) => {
                  const meal = mealsByDateSlot.get(`${date}|${slot.key}`)?.[0] ?? null;
                  const recipe = meal?.recipeId ? recipesById.get(meal.recipeId) : null;
                  const dietComponents = mealPlan.data?.dietPlan?.slots[slot.key] ?? [];
                  const coveredBy = coveredByMap.get(`${date}|${slot.key}`) ?? null;
                  const coveredRecipe = coveredBy?.recipeId
                    ? recipesById.get(coveredBy.recipeId)
                    : null;
                  // Cas 1 : slot couvert par un meal multi-jours d'un jour anterieur
                  if (coveredBy && !meal) {
                    const sourceWd = WEEKDAY_LABELS[weekdayOf(coveredBy.date)];
                    return (
                      <View key={slot.key} style={styles.slotBlock}>
                        <View style={styles.slotRow}>
                          <View style={styles.slotLabel}>
                            <Text
                              variant="labelMedium"
                              style={{
                                color: theme.colors.onSurfaceVariant,
                                fontWeight: '700',
                              }}
                            >
                              {SLOT_LABELS[slot.key] ?? slot.key}
                            </Text>
                          </View>
                          <TouchableRipple
                            borderless
                            onPress={() => onPressCoveredSlot(coveredBy, date, slot.key)}
                            style={[
                              styles.mealBox,
                              styles.mealBoxCovered,
                              {
                                backgroundColor: theme.colors.surfaceVariant,
                                borderColor: theme.colors.outlineVariant,
                              },
                            ]}
                          >
                            <View style={styles.mealBoxInner}>
                              <Text style={styles.coveredArrow}>↑</Text>
                              <Text
                                variant="bodyMedium"
                                numberOfLines={1}
                                style={{
                                  color: theme.colors.onSurfaceVariant,
                                  fontStyle: 'italic',
                                  flex: 1,
                                }}
                              >
                                Reste de{' '}
                                {coveredRecipe?.title ??
                                  coveredBy.customTitle ??
                                  sourceWd.toLowerCase()}
                              </Text>
                            </View>
                          </TouchableRipple>
                        </View>
                      </View>
                    );
                  }
                  return (
                    <View key={slot.key} style={styles.slotBlock}>
                      <View style={styles.slotRow}>
                        <View style={styles.slotLabel}>
                          <Text
                            variant="labelMedium"
                            style={{
                              color: theme.colors.onSurfaceVariant,
                              fontWeight: '700',
                            }}
                          >
                            {SLOT_LABELS[slot.key] ?? slot.key}
                          </Text>
                        </View>
                        <TouchableRipple
                          borderless
                          onPress={() => {
                            setPickerTarget({ date, slotKey: slot.key });
                            // pre-renseigne le stepper avec la valeur actuelle si meal existant
                            setPickerCoversDays(meal?.coversDays ?? 1);
                            setPickerDiners(meal?.diners ?? []);
                            setRecipePickerOpen(true);
                          }}
                          onLongPress={() => {
                            // Long press : ouvre la modale IA pre-remplie avec les
                            // composants du diet plan pour ce slot (si dispos).
                            if (dietComponents.length === 0) {
                              setPickerTarget({ date, slotKey: slot.key });
                              setPickerCoversDays(meal?.coversDays ?? 1);
                              setPickerDiners(meal?.diners ?? []);
                              setRecipePickerOpen(true);
                              return;
                            }
                            setIaContext({
                              date,
                              slotKey: slot.key,
                              components: dietComponents,
                            });
                          }}
                          style={[
                            styles.mealBox,
                            {
                              backgroundColor: meal
                                ? theme.colors.primaryContainer
                                : theme.colors.surfaceVariant,
                            },
                          ]}
                        >
                          <View style={styles.mealBoxColumn}>
                            <View style={styles.mealBoxInner}>
                              <Text
                                variant="bodyMedium"
                                numberOfLines={1}
                                style={{
                                  color: meal
                                    ? theme.colors.onPrimaryContainer
                                    : theme.colors.onSurfaceVariant,
                                  fontWeight: meal ? '700' : '500',
                                  flex: 1,
                                }}
                              >
                                {meal
                                  ? (recipe?.title ?? meal.customTitle ?? '(recette inconnue)')
                                  : '+ Ajouter'}
                              </Text>
                              {meal && meal.coversDays > 1 && (
                                <Chip
                                  compact
                                  icon="silverware-fork-knife"
                                  style={styles.coversBadge}
                                  textStyle={styles.coversBadgeText}
                                >
                                  {`x${meal.coversDays}j`}
                                </Chip>
                              )}
                              {meal &&
                                meal.diners.length > 0 &&
                                meal.diners.length < memberCount && (
                                  <Chip
                                    compact
                                    icon="account-multiple"
                                    style={styles.coversBadge}
                                    textStyle={styles.coversBadgeText}
                                  >
                                    {`${meal.diners.length}/${memberCount}`}
                                  </Chip>
                                )}
                              {meal && (
                                <View style={styles.mealActions}>
                                  <IconButton
                                    icon={meal.locked ? 'lock' : 'lock-open-outline'}
                                    size={16}
                                    onPress={() => onToggleLock(meal)}
                                    iconColor={theme.colors.onPrimaryContainer}
                                    style={styles.mealActionIcon}
                                  />
                                  <IconButton
                                    icon="close"
                                    size={16}
                                    onPress={() => onRemoveMeal(meal)}
                                    iconColor={theme.colors.onPrimaryContainer}
                                    style={styles.mealActionIcon}
                                  />
                                </View>
                              )}
                            </View>
                            {dietComponents.length > 0 && (
                              <DietComponentChips
                                components={dietComponents}
                                onContainerColor={
                                  meal ? theme.colors.surface : theme.colors.background
                                }
                              />
                            )}
                          </View>
                        </TouchableRipple>
                      </View>
                    </View>
                  );
                })
              )}
            </Surface>
          );
        })}
      </ScrollView>

      <Portal>
        <Dialog
          visible={recipePickerOpen}
          onDismiss={() => {
            setRecipePickerOpen(false);
            setPickerTarget(null);
            setPickerCoversDays(1);
            setPickerDiners([]);
          }}
        >
          <Dialog.Title>Choisir une recette</Dialog.Title>
          <View style={styles.coversRow}>
            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}>
              Ce repas couvre
            </Text>
            <IconButton
              icon="minus"
              size={18}
              disabled={pickerCoversDays <= 1}
              onPress={() => setPickerCoversDays((v) => Math.max(1, v - 1))}
            />
            <Text variant="titleMedium" style={{ minWidth: 56, textAlign: 'center' }}>
              {pickerCoversDays === 1 ? '1 jour' : `${pickerCoversDays} jours`}
            </Text>
            <IconButton
              icon="plus"
              size={18}
              disabled={pickerCoversDays >= 3}
              onPress={() => setPickerCoversDays((v) => Math.min(3, v + 1))}
            />
          </View>
          {(household.data?.members.length ?? 0) > 1 && (
            <View style={styles.dinersBlock}>
              <Text
                variant="labelMedium"
                style={{ color: theme.colors.onSurfaceVariant, marginBottom: 6 }}
              >
                Qui mange ?
              </Text>
              <View style={styles.dinersChipsRow}>
                <Chip
                  compact
                  selected={pickerDiners.length === 0}
                  onPress={() => setPickerDiners([])}
                  style={{
                    backgroundColor:
                      pickerDiners.length === 0
                        ? theme.colors.primaryContainer
                        : theme.colors.surfaceVariant,
                  }}
                  showSelectedCheck={false}
                >
                  Tous
                </Chip>
                {(household.data?.members ?? []).map((m) => {
                  const active = pickerDiners.includes(m.userId);
                  return (
                    <Chip
                      key={m.userId}
                      compact
                      selected={active}
                      onPress={() =>
                        setPickerDiners((cur) =>
                          active ? cur.filter((u) => u !== m.userId) : [...cur, m.userId],
                        )
                      }
                      style={{
                        backgroundColor: active
                          ? theme.colors.primaryContainer
                          : theme.colors.surfaceVariant,
                      }}
                      showSelectedCheck={false}
                    >
                      {(m.email ?? '?').split('@')[0]}
                    </Chip>
                  );
                })}
              </View>
            </View>
          )}
          <Dialog.ScrollArea style={{ maxHeight: 360 }}>
            <ScrollView>
              {(recipes.data?.items ?? []).length === 0 ? (
                <Text style={{ paddingVertical: 16 }}>
                  Aucune recette dans la bibliotheque. Creez-en avant de planifier.
                </Text>
              ) : (
                (recipes.data?.items ?? []).map((r) => (
                  <TouchableRipple
                    key={r.id}
                    onPress={() => onPickRecipe(r.id)}
                    style={styles.pickerRow}
                  >
                    <View>
                      <Text variant="bodyLarge" style={{ fontWeight: '600' }}>
                        {r.title}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                        <Chip compact>{`${r.servings} pers.`}</Chip>
                        {r.mealSlots.length > 0 && <Chip compact>{r.mealSlots.join(' / ')}</Chip>}
                      </View>
                    </View>
                  </TouchableRipple>
                ))
              )}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setRecipePickerOpen(false);
                setPickerTarget(null);
                setPickerCoversDays(1);
                setPickerDiners([]);
              }}
            >
              Annuler
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {iaContext && (
        <GenerateRecipeModal
          visible
          onDismiss={() => setIaContext(null)}
          onSuccess={(res) => onIaSuccess(res.recipeId)}
          initialContext={{
            mealSlot: iaContext.slotKey,
            servings: memberCount,
            dietComponents: iaContext.components,
            title: `${SLOT_LABELS[iaContext.slotKey] ?? iaContext.slotKey} du ${WEEKDAY_LABELS[weekdayOf(iaContext.date)]}`,
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: {
    padding: 16,
    gap: 10,
    paddingBottom: 32,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  flexBtn: { flex: 1, borderRadius: 12 },
  btnContent: { paddingVertical: 4 },
  dayCard: {
    padding: 12,
    borderRadius: 14,
    gap: 6,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  dayTitle: { fontWeight: '700' },
  slotBlock: {
    gap: 4,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  slotLabel: {
    width: 70,
    // S'aligne verticalement avec le centre de la 1re ligne du mealBox
    // (paddingVertical 6 + ~10px de demi-hauteur du texte bodyMedium)
    paddingTop: 8,
  },
  mealBox: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 38,
    justifyContent: 'center',
  },
  mealBoxCovered: {
    borderStyle: 'dashed',
    borderWidth: 1,
  },
  coveredArrow: {
    fontSize: 14,
    marginRight: 6,
    opacity: 0.6,
  },
  mealBoxColumn: {
    flexDirection: 'column',
    gap: 0,
  },
  mealBoxInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mealActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mealActionIcon: { margin: 0 },
  coversBadge: {
    height: 24,
    marginRight: 2,
  },
  coversBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    marginVertical: 0,
  },
  coversRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  dinersBlock: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  dinersChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pickerRow: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#0001',
  },
});
