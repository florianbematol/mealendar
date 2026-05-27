import { DietComponentChips } from '@/components/DietComponentChips';
import { GenerateRecipeModal } from '@/components/GenerateRecipeModal';
import { useHouseholdDetail } from '@/hooks/useHouseholds';
import {
  useDeletePlannedMeal,
  useMealPlan,
  useMealsRange,
  useSetMealsRange,
  useUpdatePlannedMeal,
} from '@/hooks/usePlannings';
import { useRecipes } from '@/hooks/useRecipes';
import { ApiError } from '@/lib/api';
import {
  WEEKDAY_LABELS,
  addDays,
  formatLongDate,
  formatShortDate,
  fromIsoDate,
  todayIso,
  weekdayOf,
} from '@/lib/dates';
import { haptics } from '@/lib/haptics';
import { useActiveHousehold } from '@/stores/activeHousehold';
import {
  type DietComponent,
  type PlannedMeal,
  type RecipeListItem,
  findCoveredSlots,
} from '@mealendar/shared';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
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

/**
 * Ecran "jour" : affiche les slots configures pour ce jour, avec les meals
 * en cours, et permet d'editer chaque slot (picker recette, locked, coversMeals,
 * diners, suppression).
 *
 * On charge une fenetre [date-2, date+5] pour avoir les meals couverts par
 * un coversMeals qui pourrait deborder, ainsi que pour pouvoir naviguer
 * fluidement vers le jour precedent / suivant.
 */
export default function PlanningDayScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { date } = useLocalSearchParams<{ date: string }>();
  const householdId = useActiveHousehold((s) => s.householdId);

  // Fenetre etendue : recule de 2 jours (pour les coversMeals qui couvrent
  // le repas courant) et avance d'1 jour (pour permettre l'arrow next).
  const windowFrom = useMemo(() => (date ? addDays(date, -2) : todayIso()), [date]);
  const windowTo = useMemo(() => (date ? addDays(date, 1) : todayIso()), [date]);

  const meals = useMealsRange(householdId, windowFrom, windowTo);
  const mealPlan = useMealPlan(householdId);
  const recipes = useRecipes(householdId);
  const household = useHouseholdDetail(householdId);
  const setMeals = useSetMealsRange(householdId ?? '');
  const updateMeal = useUpdatePlannedMeal(householdId ?? '');
  const deleteMeal = useDeletePlannedMeal(householdId ?? '');

  const memberCount = Math.max(1, household.data?.members.length ?? 4);

  const [recipePickerOpen, setRecipePickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<{ date: string; slotKey: string } | null>(null);
  const [pickerCoversMeals, setPickerCoversMeals] = useState<number>(1);
  const [pickerDiners, setPickerDiners] = useState<string[]>([]);
  const [iaContext, setIaContext] = useState<{
    date: string;
    slotKey: string;
    components: DietComponent[];
  } | null>(null);

  useLayoutEffect(() => {
    if (!date) return;
    navigation.setOptions({
      title: formatLongDate(date),
    });
  }, [navigation, date]);

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

  // Slots du jour focus (union plan-type + slots des meals deja presents)
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

  /**
   * Quand on confirme un choix de recette dans le picker, on cree ou modifie
   * le meal pour le slot cible. On utilise setMealsRange sur la fenetre 1 jour
   * (date du target) pour ne toucher qu'a ce jour-la.
   */
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
      // On reconstruit la liste complete des meals du jour pour appeler
      // setMealsRange sur cette journee uniquement.
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

  /**
   * Lib re un slot couvert : on reduit coversMeals du meal source pour qu'il
   * ne couvre plus le target. Identique a l'ancien comportement.
   */
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
      } catch (e) {
        Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
      }
      return;
    }
    // Sinon on cree le meal en re-uploadant le jour entier
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
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  if (!date) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <Text variant="titleMedium">Date manquante</Text>
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

  const slots = slotsForDay(date);
  const wd = weekdayOf(date);

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
        {/* Navigation jour precedent / suivant */}
        <View style={styles.navRow}>
          <IconButton
            icon="chevron-left"
            onPress={() =>
              router.replace({
                pathname: '/(app)/(tabs)/planning/day/[date]',
                params: { date: addDays(date, -1) },
              })
            }
          />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text variant="titleSmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {WEEKDAY_LABELS[wd]}
            </Text>
            <Text variant="titleLarge" style={{ fontWeight: '800' }}>
              {fromIsoDate(date).getDate()}{' '}
              {
                [
                  'janvier',
                  'fevrier',
                  'mars',
                  'avril',
                  'mai',
                  'juin',
                  'juillet',
                  'aout',
                  'septembre',
                  'octobre',
                  'novembre',
                  'decembre',
                ][fromIsoDate(date).getMonth()]
              }
            </Text>
          </View>
          <IconButton
            icon="chevron-right"
            onPress={() =>
              router.replace({
                pathname: '/(app)/(tabs)/planning/day/[date]',
                params: { date: addDays(date, 1) },
              })
            }
          />
        </View>

        <Surface elevation={0} style={[styles.dayCard, { backgroundColor: theme.colors.surface }]}>
          {slots.length === 0 ? (
            <Text
              variant="bodySmall"
              style={{ color: theme.colors.onSurfaceVariant, fontStyle: 'italic', padding: 8 }}
            >
              Aucun slot configure pour ce jour. Configurez votre semaine type.
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
                        style={{ color: theme.colors.onSurfaceVariant, fontWeight: '700' }}
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
                          {meal && meal.diners.length > 0 && meal.diners.length < memberCount && (
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
                            onContainerColor={meal ? theme.colors.surface : theme.colors.background}
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
      </ScrollView>

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
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  dayCard: { padding: 12, borderRadius: 14, gap: 8 },
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
