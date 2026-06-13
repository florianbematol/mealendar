import { DietComponentChips } from '@/components/DietComponentChips';
import { GenerateRecipeModal } from '@/components/GenerateRecipeModal';
import { useHouseholdDetail } from '@/hooks/useHouseholds';
import {
  useCreateMealPlanRange,
  useDeleteMealPlanRange,
  useDeletePlannedMeal,
  useDuplicateMealsRange,
  useGeneratePlanningWithLlm,
  useMealPlan,
  useMealPlanRanges,
  useMealsRange,
  useSetMealsRange,
  useUpdatePlannedMeal,
} from '@/hooks/usePlannings';
import { useRecipes } from '@/hooks/useRecipes';
import { ApiError, fetchHouseholdIcs } from '@/lib/api';
import {
  WEEKDAY_LABELS,
  addDays,
  formatShortDate,
  fromIsoDate,
  rangeDates,
  weekdayOf,
} from '@/lib/dates';
import { haptics } from '@/lib/haptics';
import { generatePlanningMeals } from '@/lib/planningGenerator';
import { useActiveHousehold } from '@/stores/activeHousehold';
import {
  type DietComponent,
  type PlannedMeal,
  type RecipeListItem,
  findCoveredSlots,
} from '@mealendar/shared';
import * as FileSystem from 'expo-file-system';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  Dialog,
  Divider,
  IconButton,
  Menu,
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

/**
 * Ecran "plage de jours" : affiche les slots configures pour chaque jour
 * de la plage [from, to], avec edition par slot (picker recette, locked,
 * coversMeals, diners, suppression). Boutons d'actions globaux en haut :
 * Aleatoire / IA / Effacer / Liste de courses / ICS.
 *
 * Reprend la logique de day/[date].tsx mais en boucle sur N jours.
 *
 * On charge une fenetre etendue [from-2, to+1] pour gerer les coversMeals
 * qui pourraient deborder dans l'affichage des slots couverts.
 */
export default function PlanningRangeScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { from, to } = useLocalSearchParams<{ from: string; to: string }>();
  const householdId = useActiveHousehold((s) => s.householdId);

  const fromDate = from ?? '';
  const toDate = to ?? '';

  // Fenetre etendue : recule de 2 jours pour les coversMeals qui couvrent le repas courant.
  const windowFrom = useMemo(() => (fromDate ? addDays(fromDate, -2) : ''), [fromDate]);
  const windowTo = useMemo(() => (toDate ? addDays(toDate, 1) : ''), [toDate]);

  const meals = useMealsRange(householdId, windowFrom, windowTo);
  const mealPlan = useMealPlan(householdId);
  const recipes = useRecipes(householdId);
  const household = useHouseholdDetail(householdId);
  const setMeals = useSetMealsRange(householdId ?? '');
  const updateMeal = useUpdatePlannedMeal(householdId ?? '');
  const deleteMeal = useDeletePlannedMeal(householdId ?? '');
  const generateLlm = useGeneratePlanningWithLlm(householdId ?? '');
  const duplicateRange = useDuplicateMealsRange(householdId ?? '');
  const allRanges = useMealPlanRanges(householdId);
  const deleteRange = useDeleteMealPlanRange(householdId ?? '');
  const createRange = useCreateMealPlanRange();

  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);

  const memberCount = Math.max(1, household.data?.members.length ?? 4);

  const dates = useMemo(
    () => (fromDate && toDate ? rangeDates(fromDate, toDate) : []),
    [fromDate, toDate],
  );
  const dayCount = dates.length;

  const [recipePickerOpen, setRecipePickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<{ date: string; slotKey: string } | null>(null);
  const [pickerCoversMeals, setPickerCoversMeals] = useState<number>(1);
  const [pickerDiners, setPickerDiners] = useState<string[]>([]);
  const [iaContext, setIaContext] = useState<{
    date: string;
    slotKey: string;
    components: DietComponent[];
  } | null>(null);

  // Ref vers les dernieres actions/etats, pour que le Menu du header appelle
  // toujours des closures fraiches sans avoir a recreer le headerRight.
  const headerActionsRef = useRef<{
    onDuplicate: () => void;
    onClear: () => void;
    onDelete: () => void;
    busy: boolean;
  }>({ onDuplicate: () => {}, onClear: () => {}, onDelete: () => {}, busy: false });

  useLayoutEffect(() => {
    if (!fromDate || !toDate) return;
    const fromLabel = formatShortDate(fromDate);
    const toLabel = formatShortDate(toDate);
    const title = fromDate === toDate ? fromLabel : `${fromLabel} → ${toLabel} (${dayCount}j)`;
    navigation.setOptions({
      title,
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconButton
            icon="cart-outline"
            size={20}
            onPress={() =>
              router.push({
                pathname: '/(app)/(tabs)/planning/shopping',
                params: { from: fromDate, to: toDate },
              })
            }
          />
          <IconButton icon="calendar-export" size={20} onPress={() => onExportIcs()} />
          <Menu
            visible={menuOpen}
            onDismiss={() => setMenuOpen(false)}
            anchor={<IconButton icon="dots-vertical" size={20} onPress={() => setMenuOpen(true)} />}
          >
            <Menu.Item
              leadingIcon="content-duplicate"
              title="Dupliquer cette plage"
              disabled={headerActionsRef.current.busy}
              onPress={() => {
                setMenuOpen(false);
                headerActionsRef.current.onDuplicate();
              }}
            />
            <Menu.Item
              leadingIcon="delete-sweep-outline"
              title="Effacer les repas"
              disabled={headerActionsRef.current.busy}
              onPress={() => {
                setMenuOpen(false);
                headerActionsRef.current.onClear();
              }}
            />
            <Divider />
            <Menu.Item
              leadingIcon="trash-can-outline"
              title="Supprimer la plage"
              titleStyle={{ color: theme.colors.error }}
              disabled={headerActionsRef.current.busy}
              onPress={() => {
                setMenuOpen(false);
                headerActionsRef.current.onDelete();
              }}
            />
          </Menu>
        </View>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, fromDate, toDate, dayCount, menuOpen, theme.colors.error]);

  const allMeals = meals.data?.meals ?? [];

  const mealsByDateSlot = useMemo(() => {
    const map = new Map<string, PlannedMeal[]>();
    for (const m of allMeals) {
      const k = `${m.date}|${m.slotKey}`;
      const arr = map.get(k) ?? [];
      arr.push(m);
      map.set(k, arr);
    }
    return map;
  }, [allMeals]);

  const coveredByMap = useMemo(() => {
    const map = new Map<string, PlannedMeal>();
    if (!mealPlan.data) return map;
    for (const m of allMeals) {
      const cm = m.coversMeals ?? 1;
      if (cm <= 1) continue;
      const covered = findCoveredSlots({
        sourceDate: m.date,
        sourceSlotKey: m.slotKey,
        coversMeals: cm,
        slotConfig: mealPlan.data.slotConfig,
      });
      for (const c of covered) {
        map.set(`${c.date}|${c.slotKey}`, m);
      }
    }
    return map;
  }, [allMeals, mealPlan.data]);

  const recipesById = useMemo(() => {
    const map = new Map<string, RecipeListItem>();
    for (const r of recipes.data?.items ?? []) map.set(r.id, r);
    return map;
  }, [recipes.data]);

  const slotsForDay = (d: string) => {
    const wd = weekdayOf(d);
    const planSlots = mealPlan.data?.slotConfig[wd] ?? [];
    const slotsFromMeals = allMeals.filter((m) => m.date === d).map((m) => ({ key: m.slotKey }));
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

  // ===========================================================================
  // Actions globales : Aleatoire / IA / Effacer sur le range
  // ===========================================================================
  /**
   * Assure qu'une plage [from,to] (sans nom) existe pour cette periode. Appelee
   * apres qu'un repas a ete pose, pour que la plage apparaisse sur le calendrier.
   * Idempotent : ne cree rien si une plage couvre deja exactement [from,to].
   */
  const ensureRange = async () => {
    if (!householdId) return;
    const exists = (allRanges.data ?? []).some(
      (r) => r.dateFrom === fromDate && r.dateTo === toDate,
    );
    if (exists) return;
    try {
      await createRange.mutateAsync({
        householdId,
        name: '',
        dateFrom: fromDate,
        dateTo: toDate,
      });
    } catch {
      // Non bloquant : si la creation de plage echoue, le repas est quand meme pose.
    }
  };

  const onGenerateRandom = async () => {
    if (!householdId || !mealPlan.data) {
      Alert.alert('Plan-type requis', "Configurez d'abord votre plan-type.", [
        { text: 'Plus tard', style: 'cancel' },
        {
          text: 'Configurer',
          onPress: () => router.push('/(app)/(tabs)/planning/meal-plan'),
        },
      ]);
      return;
    }
    if ((recipes.data?.items.length ?? 0) === 0) {
      Alert.alert('Aucune recette', 'Ajoutez au moins quelques recettes pour pouvoir generer.');
      return;
    }
    const generated = generatePlanningMeals({
      startDate: fromDate,
      endDate: toDate,
      slotConfig: mealPlan.data.slotConfig,
      recipes: recipes.data?.items ?? [],
      existingMeals: allMeals.filter((m) => m.date >= fromDate && m.date <= toDate),
      varietyRules: mealPlan.data.varietyRules,
      defaultServings: memberCount,
    });
    try {
      await setMeals.mutateAsync({
        dateFrom: fromDate,
        dateTo: toDate,
        meals: generated,
        keepLocked: true,
      });
      await ensureRange();
      haptics.success();
    } catch (e) {
      haptics.error();
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  const onGenerateLlm = async () => {
    if (!householdId || !mealPlan.data) {
      Alert.alert('Plan-type requis', "Configurez d'abord votre plan-type.");
      return;
    }
    if ((recipes.data?.items.length ?? 0) === 0) {
      Alert.alert('Aucune recette', 'Ajoutez au moins quelques recettes a votre bibliotheque.');
      return;
    }
    Alert.alert(
      "Generer avec l'IA ?",
      `L'IA va planifier ${dayCount} jour${dayCount > 1 ? 's' : ''}. Consomme 1 unite de quota LLM.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Generer',
          onPress: async () => {
            try {
              const res = await generateLlm.mutateAsync({
                householdId,
                dateFrom: fromDate,
                dateTo: toDate,
                keepLocked: true,
              });
              await ensureRange();
              haptics.success();
              const skippedTxt =
                res.skipped > 0
                  ? ` ${res.skipped} slot${res.skipped > 1 ? 's' : ''} non rempli${res.skipped > 1 ? 's' : ''}.`
                  : '';
              Alert.alert(
                'Repas generes',
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

  const onClearRange = () => {
    Alert.alert('Tout effacer', 'Supprime tous les repas de cette plage (sauf les verrouilles).', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Effacer',
        style: 'destructive',
        onPress: async () => {
          try {
            await setMeals.mutateAsync({
              dateFrom: fromDate,
              dateTo: toDate,
              meals: [],
              keepLocked: true,
            });
          } catch (e) {
            Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
          }
        },
      },
    ]);
  };

  /**
   * Supprime completement cette plage : vide les repas de [from,to] ET supprime
   * la/les etiquette(s) de plage qui chevauchent la periode. Puis revient.
   */
  const onDeleteRange = () => {
    Alert.alert(
      'Supprimer la plage',
      'Supprime cette plage du calendrier ET tous ses repas (y compris verrouilles). Action irreversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              // 1. Vide les repas de la periode (sans garder les verrouilles).
              await setMeals.mutateAsync({
                dateFrom: fromDate,
                dateTo: toDate,
                meals: [],
                keepLocked: false,
              });
              // 2. Supprime les etiquettes de plage qui chevauchent [from,to].
              const overlapping = (allRanges.data ?? []).filter(
                (r) => !(r.dateTo < fromDate || r.dateFrom > toDate),
              );
              for (const r of overlapping) {
                await deleteRange.mutateAsync(r.id);
              }
              haptics.success();
              router.back();
            } catch (e) {
              haptics.error();
              Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
            }
          },
        },
      ],
    );
  };

  const onExportIcs = async () => {
    if (!householdId) return;
    try {
      const ics = await fetchHouseholdIcs(householdId, fromDate, toDate);
      const file = new FileSystem.File(
        FileSystem.Paths.cache,
        `mealendar-${fromDate}_${toDate}.ics`,
      );
      if (file.exists) file.delete();
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
   * Duplique tous les repas de la plage courante a une date cible. La date
   * cible devient la nouvelle 'dateFrom' (l'offset est calcule). On cree
   * aussi une nouvelle plage nommee.
   */
  const onDuplicate = async (targetStart: string) => {
    if (!householdId) return;
    setDuplicateOpen(false);
    try {
      const res = await duplicateRange.mutateAsync({
        householdId,
        sourceFrom: fromDate,
        sourceTo: toDate,
        targetStart,
        createRangeName: `Plage du ${formatShortDate(targetStart)}`,
      });
      haptics.success();
      Alert.alert(
        'Plage dupliquee',
        `${res.inserted} repas ajoute${res.inserted > 1 ? 's' : ''} du ${formatShortDate(res.targetFrom)} au ${formatShortDate(res.targetTo)}.`,
        [
          { text: 'Rester ici', style: 'cancel' },
          {
            text: 'Voir la copie',
            onPress: () => {
              router.replace(`/(app)/(tabs)/planning/range/${res.targetFrom}/${res.targetTo}`);
            },
          },
        ],
      );
    } catch (e) {
      haptics.error();
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  // ===========================================================================
  // Actions sur 1 slot (picker, lock, suppression, IA contextuelle)
  // ===========================================================================
  const onPickRecipe = async (recipeId: string) => {
    if (!pickerTarget || !householdId) return;
    const targetDate = pickerTarget.date;
    const existing = mealsByDateSlot.get(`${targetDate}|${pickerTarget.slotKey}`)?.[0];
    const coversMeals = Math.min(3, Math.max(1, pickerCoversMeals));
    const effectiveDinerCount = pickerDiners.length > 0 ? pickerDiners.length : memberCount;
    const servings = effectiveDinerCount * coversMeals;

    if (existing) {
      try {
        await updateMeal.mutateAsync({
          mealId: existing.id,
          input: {
            recipeId,
            customTitle: null,
            coversMeals,
            servings,
            diners: pickerDiners,
          },
        });
      } catch (e) {
        Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
      }
    } else {
      const dayMeals = allMeals
        .filter((m) => m.date === targetDate)
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
          coversMeals: m.coversMeals,
        }));
      try {
        await setMeals.mutateAsync({
          dateFrom: targetDate,
          dateTo: targetDate,
          keepLocked: false,
          meals: [
            ...dayMeals,
            {
              date: targetDate,
              slotKey: pickerTarget.slotKey,
              recipeId,
              servings,
              diners: pickerDiners,
              locked: false,
              position: 0,
              coversMeals,
            },
          ],
        });
      } catch (e) {
        Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
      }
    }
    await ensureRange();
    setRecipePickerOpen(false);
    setPickerTarget(null);
    setPickerCoversMeals(1);
    setPickerDiners([]);
  };

  const onRemoveMeal = async (meal: PlannedMeal) => {
    try {
      await deleteMeal.mutateAsync(meal.id);
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

  const onPressCoveredSlot = (
    sourceMeal: PlannedMeal,
    targetDate: string,
    targetSlotKey: string,
  ) => {
    const sourceWd = WEEKDAY_LABELS[weekdayOf(sourceMeal.date)];
    const sourceDateLabel = formatShortDate(sourceMeal.date);

    Alert.alert(
      'Repas couvert',
      `Ce creneau est couvert par le repas du ${sourceWd} ${sourceDateLabel}.`,
      [
        { text: 'OK', style: 'cancel' },
        {
          text: 'Liberer ce creneau',
          onPress: async () => {
            if (!mealPlan.data) return;
            const covered = findCoveredSlots({
              sourceDate: sourceMeal.date,
              sourceSlotKey: sourceMeal.slotKey,
              coversMeals: sourceMeal.coversMeals,
              slotConfig: mealPlan.data.slotConfig,
            });
            const targetIdx = covered.findIndex(
              (c) => c.date === targetDate && c.slotKey === targetSlotKey,
            );
            const newCoversMeals = targetIdx >= 0 ? targetIdx + 1 : 1;
            const newServings =
              sourceMeal.servings > 0 && sourceMeal.coversMeals > 0
                ? Math.round((sourceMeal.servings / sourceMeal.coversMeals) * newCoversMeals)
                : sourceMeal.servings;
            try {
              await updateMeal.mutateAsync({
                mealId: sourceMeal.id,
                input: { coversMeals: newCoversMeals, servings: newServings },
              });
            } catch (e) {
              Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
            }
          },
        },
      ],
    );
  };

  const onIaSuccess = async (recipeId: string | null) => {
    const ctx = iaContext;
    setIaContext(null);
    if (!recipeId || !ctx) return;

    const existing = mealsByDateSlot.get(`${ctx.date}|${ctx.slotKey}`)?.[0];
    if (existing) {
      try {
        await updateMeal.mutateAsync({
          mealId: existing.id,
          input: { recipeId, customTitle: null },
        });
        await ensureRange();
      } catch (e) {
        Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
      }
      return;
    }
    const dayMeals = allMeals
      .filter((m) => m.date === ctx.date)
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
        coversMeals: m.coversMeals,
      }));
    try {
      await setMeals.mutateAsync({
        dateFrom: ctx.date,
        dateTo: ctx.date,
        keepLocked: false,
        meals: [
          ...dayMeals,
          {
            date: ctx.date,
            slotKey: ctx.slotKey,
            recipeId,
            servings: memberCount,
            diners: [],
            locked: false,
            position: 0,
            coversMeals: 1,
          },
        ],
      });
      await ensureRange();
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  // ===========================================================================
  // Render
  // ===========================================================================
  // Met a jour la ref consommee par le Menu du header a chaque render.
  headerActionsRef.current = {
    onDuplicate: () => setDuplicateOpen(true),
    onClear: onClearRange,
    onDelete: onDeleteRange,
    busy: setMeals.isPending || generateLlm.isPending,
  };

  if (!fromDate || !toDate) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <Text variant="titleMedium">Plage manquante</Text>
      </View>
    );
  }
  if (meals.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }
  if (meals.isError) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <Text variant="titleMedium">Erreur de chargement</Text>
        <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
          {meals.error instanceof ApiError
            ? `${meals.error.status} - ${meals.error.message}`
            : (meals.error as Error).message}
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={[]}>
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={meals.isFetching && !meals.isPending}
            onRefresh={() => meals.refetch()}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* Indicateur de generation en cours (Aleatoire/IA/Dupliquer sont dans le menu ...) */}
        {(setMeals.isPending || generateLlm.isPending) && (
          <View style={[styles.busyRow, { backgroundColor: theme.colors.primaryContainer }]}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text variant="labelLarge" style={{ color: theme.colors.onPrimaryContainer }}>
              {generateLlm.isPending ? 'Generation IA en cours…' : 'Mise a jour des repas…'}
            </Text>
          </View>
        )}

        {/* Une carte par jour */}
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
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>
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
                            setPickerCoversMeals(meal?.coversMeals ?? 1);
                            setPickerDiners(meal?.diners ?? []);
                            setRecipePickerOpen(true);
                          }}
                          onLongPress={() => {
                            if (dietComponents.length === 0) {
                              setPickerTarget({ date, slotKey: slot.key });
                              setPickerCoversMeals(meal?.coversMeals ?? 1);
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
                              {meal && meal.coversMeals > 1 && (
                                <Chip
                                  compact
                                  icon="silverware-fork-knife"
                                  style={styles.coversBadge}
                                  textStyle={styles.coversBadgeText}
                                >
                                  {`x${meal.coversMeals}`}
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

      {/* Barre d'action principale fixe en bas : remplir le planning */}
      <View style={[styles.bottomBar, { borderTopColor: theme.colors.outlineVariant }]}>
        <Button
          mode="contained"
          icon="playlist-plus"
          onPress={() => setFillOpen(true)}
          disabled={setMeals.isPending || generateLlm.isPending}
          style={styles.fillBtn}
          contentStyle={styles.fillBtnContent}
        >
          Remplir le planning
        </Button>
      </View>

      {/* Choix du mode de remplissage : Aleatoire ou IA */}
      <Portal>
        <Dialog visible={fillOpen} onDismiss={() => setFillOpen(false)}>
          <Dialog.Title>Remplir le planning</Dialog.Title>
          <Dialog.Content style={{ gap: 8 }}>
            <Button
              mode="contained"
              icon="dice-multiple-outline"
              onPress={() => {
                setFillOpen(false);
                onGenerateRandom();
              }}
              contentStyle={styles.fillChoiceContent}
            >
              Aleatoire (depuis mes recettes)
            </Button>
            <Button
              mode="contained-tonal"
              icon="auto-fix"
              onPress={() => {
                setFillOpen(false);
                onGenerateLlm();
              }}
              contentStyle={styles.fillChoiceContent}
            >
              Generer avec l'IA
            </Button>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setFillOpen(false)}>Annuler</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Dialog de duplication : raccourcis +7j / +14j / +28j */}
      <Portal>
        <Dialog visible={duplicateOpen} onDismiss={() => setDuplicateOpen(false)}>
          <Dialog.Title>Dupliquer cette plage</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ marginBottom: 12 }}>
              Plage source : {formatShortDate(fromDate)} → {formatShortDate(toDate)} ({dayCount}{' '}
              jour{dayCount > 1 ? 's' : ''})
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}
            >
              Choisissez quand commencer la copie :
            </Text>
            <View style={{ gap: 8 }}>
              {[
                { label: 'Semaine prochaine (+7 jours)', offset: 7 },
                { label: 'Dans 2 semaines (+14 jours)', offset: 14 },
                { label: 'Dans 1 mois (+28 jours)', offset: 28 },
              ].map((opt) => {
                const target = addDays(fromDate, opt.offset);
                const targetEnd = addDays(target, dayCount - 1);
                return (
                  <Button
                    key={opt.offset}
                    mode="outlined"
                    onPress={() => onDuplicate(target)}
                    contentStyle={{ paddingVertical: 4, justifyContent: 'flex-start' }}
                  >
                    {opt.label} · {formatShortDate(target)} → {formatShortDate(targetEnd)}
                  </Button>
                );
              })}
            </View>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDuplicateOpen(false)}>Annuler</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Picker recette */}
      <Portal>
        <Dialog
          visible={recipePickerOpen}
          onDismiss={() => {
            setRecipePickerOpen(false);
            setPickerTarget(null);
            setPickerCoversMeals(1);
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
              disabled={pickerCoversMeals <= 1}
              onPress={() => setPickerCoversMeals((v) => Math.max(1, v - 1))}
            />
            <Text variant="titleMedium" style={{ minWidth: 56, textAlign: 'center' }}>
              {pickerCoversMeals === 1 ? '1 repas' : `${pickerCoversMeals} repas`}
            </Text>
            <IconButton
              icon="plus"
              size={18}
              disabled={pickerCoversMeals >= 3}
              onPress={() => setPickerCoversMeals((v) => Math.min(3, v + 1))}
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
              {(() => {
                // Filtre par slot : on garde les recettes taguees pour le slot
                // cible + celles sans aucun tag (passe-partout). On cache celles
                // taguees uniquement pour d'autres slots.
                const slotKey = pickerTarget?.slotKey;
                const filtered = (recipes.data?.items ?? []).filter((r) => {
                  if (!slotKey) return true;
                  if (r.mealSlots.length === 0) return true;
                  return r.mealSlots.includes(slotKey);
                });
                if ((recipes.data?.items ?? []).length === 0) {
                  return (
                    <Text style={{ paddingVertical: 16 }}>
                      Aucune recette dans la bibliotheque. Creez-en avant de planifier.
                    </Text>
                  );
                }
                if (filtered.length === 0) {
                  return (
                    <Text style={{ paddingVertical: 16, color: theme.colors.onSurfaceVariant }}>
                      Aucune recette pour ce repas. Taguez des recettes pour ce creneau (ou
                      laissez-les sans tag pour les rendre disponibles partout).
                    </Text>
                  );
                }
                return filtered.map((r) => (
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
                ));
              })()}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setRecipePickerOpen(false);
                setPickerTarget(null);
                setPickerCoversMeals(1);
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
  container: { padding: 16, gap: 12, paddingBottom: 32 },

  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  fillBtn: { borderRadius: 14 },
  fillBtnContent: { paddingVertical: 6 },
  fillChoiceContent: { paddingVertical: 6, justifyContent: 'flex-start' },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
  },

  dayCard: { padding: 12, borderRadius: 14, gap: 6 },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  slotBlock: { gap: 4 },
  slotRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  slotLabel: { width: 70, paddingTop: 8 },
  mealBox: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 38,
    justifyContent: 'center',
  },
  mealBoxCovered: { borderStyle: 'dashed', borderWidth: 1 },
  coveredArrow: { fontSize: 14, marginRight: 6, opacity: 0.6 },
  mealBoxColumn: { flexDirection: 'column', gap: 0 },
  mealBoxInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  mealActions: { flexDirection: 'row', alignItems: 'center' },
  mealActionIcon: { margin: 0 },
  coversBadge: { height: 24, marginRight: 2 },
  coversBadgeText: { fontSize: 11, lineHeight: 14, marginVertical: 0 },
  coversRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  dinersBlock: { paddingHorizontal: 24, paddingBottom: 8 },
  dinersChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pickerRow: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#0001',
  },
});
