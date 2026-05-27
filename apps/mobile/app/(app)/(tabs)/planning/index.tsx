import { Topbar } from '@/components/Topbar';
import { useMyDietPlan } from '@/hooks/useDietPlans';
import {
  useGeneratePlanningWithLlm,
  useMealPlan,
  useMealsRange,
  useSetMealsRange,
} from '@/hooks/usePlannings';
import { useRecipes } from '@/hooks/useRecipes';
import { ApiError } from '@/lib/api';
import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  addMonths,
  endOfMonth,
  formatMonthYear,
  isSameMonth,
  monthGrid,
  startOfMonth,
  startOfWeek,
  todayIso,
  weekDates,
} from '@/lib/dates';
import { haptics } from '@/lib/haptics';
import { generatePlanningMeals } from '@/lib/planningGenerator';
import { useActiveHousehold } from '@/stores/activeHousehold';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  IconButton,
  SegmentedButtons,
  Surface,
  Text,
  TouchableRipple,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

type ViewMode = 'month' | 'week';

export default function PlanningIndexScreen() {
  const theme = useTheme();
  const householdId = useActiveHousehold((s) => s.householdId);
  const mealPlan = useMealPlan(householdId);
  const myDietPlan = useMyDietPlan(householdId);
  const recipes = useRecipes(householdId);

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  /** Date de reference pour calculer la fenetre affichee. */
  const [refDate, setRefDate] = useState<string>(todayIso());

  // ---------------------------------------------------------------------------
  // Calcul de la fenetre [from, to] selon viewMode + refDate
  // ---------------------------------------------------------------------------
  const window = useMemo(() => {
    if (viewMode === 'week') {
      const dates = weekDates(refDate);
      return {
        from: dates[0] as string,
        to: dates[dates.length - 1] as string,
        cells: dates,
      };
    }
    // month : grille de 6 semaines (42 cases) lundi-aligne
    const cells = monthGrid(refDate);
    return {
      from: cells[0] as string,
      to: cells[cells.length - 1] as string,
      cells,
    };
  }, [viewMode, refDate]);

  const meals = useMealsRange(householdId, window.from, window.to);
  const setMeals = useSetMealsRange(householdId ?? '');
  const generateLlm = useGeneratePlanningWithLlm(householdId ?? '');

  // ---------------------------------------------------------------------------
  // Index : nb de meals par date (pour le badge de chaque cellule)
  // ---------------------------------------------------------------------------
  const mealCountByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of meals.data?.meals ?? []) {
      map.set(m.date, (map.get(m.date) ?? 0) + 1);
    }
    return map;
  }, [meals.data]);

  // ---------------------------------------------------------------------------
  // Setup state (reutilise la SetupSection existante)
  // ---------------------------------------------------------------------------
  const slotsPerWeek = mealPlan.data
    ? Object.values(mealPlan.data.slotConfig).reduce((acc, ds) => acc + (ds?.length ?? 0), 0)
    : 0;

  const dietPlanConfigured =
    !!myDietPlan.data &&
    (myDietPlan.data.regimes.length > 0 ||
      myDietPlan.data.allergies.length > 0 ||
      myDietPlan.data.goals.length > 0 ||
      Object.values(myDietPlan.data.dietPlan.slots).some((s) => (s ?? []).length > 0));

  const dietComponentsCount = myDietPlan.data
    ? Object.values(myDietPlan.data.dietPlan.slots).reduce(
        (acc, comps) => acc + (comps?.length ?? 0),
        0,
      )
    : 0;
  const dietRulesCount = myDietPlan.data?.dietPlan?.dailyRules?.length ?? 0;

  // ---------------------------------------------------------------------------
  // Actions de generation sur la fenetre courante
  // ---------------------------------------------------------------------------
  const onGenerateRandom = async () => {
    if (!householdId || !mealPlan.data) {
      Alert.alert(
        'Plan-type requis',
        "Configurez d'abord votre plan-type pour generer des repas.",
        [
          { text: 'Plus tard', style: 'cancel' },
          { text: 'Configurer', onPress: () => router.push('/(app)/(tabs)/planning/meal-plan') },
        ],
      );
      return;
    }
    if ((recipes.data?.items.length ?? 0) === 0) {
      Alert.alert(
        'Aucune recette',
        'Ajoutez au moins quelques recettes a votre bibliotheque pour pouvoir generer.',
      );
      return;
    }
    const generated = generatePlanningMeals({
      startDate: window.from,
      endDate: window.to,
      slotConfig: mealPlan.data.slotConfig,
      recipes: recipes.data?.items ?? [],
      existingMeals: meals.data?.meals ?? [],
      varietyRules: mealPlan.data.varietyRules,
      defaultServings: 4,
    });
    try {
      await setMeals.mutateAsync({
        dateFrom: window.from,
        dateTo: window.to,
        meals: generated,
        keepLocked: true,
      });
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
      Alert.alert(
        'Aucune recette',
        "Ajoutez au moins quelques recettes a votre bibliotheque avant de demander a l'IA.",
      );
      return;
    }
    Alert.alert(
      "Generer avec l'IA ?",
      `L'IA va planifier les repas du ${formatRangeLabel(window.from, window.to)}. Consomme 1 unite de quota LLM.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Generer',
          onPress: async () => {
            try {
              const res = await generateLlm.mutateAsync({
                householdId,
                dateFrom: window.from,
                dateTo: window.to,
                keepLocked: true,
              });
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

  const onClearWindow = async () => {
    if (!householdId) return;
    Alert.alert(
      'Tout effacer',
      `Supprime tous les repas du ${formatRangeLabel(window.from, window.to)} (sauf les verrouilles).`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Effacer',
          style: 'destructive',
          onPress: async () => {
            try {
              await setMeals.mutateAsync({
                dateFrom: window.from,
                dateTo: window.to,
                meals: [],
                keepLocked: true,
              });
            } catch (e) {
              Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
            }
          },
        },
      ],
    );
  };

  // ---------------------------------------------------------------------------
  // Navigation periode prev/next
  // ---------------------------------------------------------------------------
  const onPrev = () => {
    if (viewMode === 'week') setRefDate((d) => addDaysSafe(d, -7));
    else setRefDate((d) => addMonths(d, -1));
  };
  const onNext = () => {
    if (viewMode === 'week') setRefDate((d) => addDaysSafe(d, 7));
    else setRefDate((d) => addMonths(d, 1));
  };
  const onToday = () => setRefDate(todayIso());

  const headerLabel = useMemo(() => {
    if (viewMode === 'week') {
      const start = startOfWeek(refDate);
      return formatRangeLabel(start, addDaysSafe(start, 6));
    }
    return formatMonthYear(refDate);
  }, [viewMode, refDate]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
      edges={['top']}
    >
      <Topbar
        right={
          <View style={{ flexDirection: 'row' }}>
            <IconButton
              icon="cart-outline"
              size={22}
              onPress={() =>
                router.push({
                  pathname: '/(app)/(tabs)/planning/shopping',
                  params: { from: window.from, to: window.to },
                })
              }
              iconColor={theme.colors.onSurfaceVariant}
            />
            <IconButton
              icon="cog-outline"
              size={22}
              onPress={() => router.push('/(app)/(tabs)/planning/meal-plan')}
              iconColor={theme.colors.onSurfaceVariant}
            />
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={meals.isFetching && !meals.isPending}
            onRefresh={() => {
              void meals.refetch();
              void mealPlan.refetch();
            }}
            tintColor={theme.colors.primary}
          />
        }
      >
        <View style={styles.header}>
          <Text variant="titleLarge" style={styles.title}>
            Planning
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Tapez un jour pour planifier les repas.
          </Text>
        </View>

        {/* Setup checklist (semaine type + plan alimentaire) */}
        <SetupSection
          mealPlanConfigured={!!mealPlan.data}
          dietPlanConfigured={dietPlanConfigured}
          mealPlanSummary={mealPlan.data ? `${slotsPerWeek} repas / semaine` : null}
          dietPlanSummary={
            dietPlanConfigured
              ? `${dietComponentsCount} composant${dietComponentsCount > 1 ? 's' : ''}${
                  dietRulesCount > 0
                    ? ` · ${dietRulesCount} regle${dietRulesCount > 1 ? 's' : ''}`
                    : ''
                }`
              : null
          }
          onMealPlanPress={() => router.push('/(app)/(tabs)/planning/meal-plan')}
          onDietPlanPress={() => router.push('/(app)/(tabs)/planning/diet-plan')}
        />

        {/* Toggle vue + navigation periode */}
        <View style={styles.toolbarRow}>
          <SegmentedButtons
            value={viewMode}
            onValueChange={(v) => setViewMode(v as ViewMode)}
            density="small"
            style={{ flex: 1 }}
            buttons={[
              { value: 'month', label: 'Mois', icon: 'calendar-month-outline' },
              { value: 'week', label: 'Semaine', icon: 'calendar-week-outline' },
            ]}
          />
        </View>
        <View style={styles.navRow}>
          <IconButton icon="chevron-left" onPress={onPrev} />
          <TouchableRipple onPress={onToday} style={{ flex: 1 }} borderless>
            <Text variant="titleMedium" style={styles.navLabel}>
              {headerLabel}
            </Text>
          </TouchableRipple>
          <IconButton icon="chevron-right" onPress={onNext} />
        </View>

        {meals.isPending ? (
          <View style={styles.loaderRow}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
          </View>
        ) : viewMode === 'month' ? (
          <MonthGrid
            cells={window.cells}
            refDate={refDate}
            mealCountByDate={mealCountByDate}
            onPressCell={(date) =>
              router.push({ pathname: '/(app)/(tabs)/planning/day/[date]', params: { date } })
            }
          />
        ) : (
          <WeekList
            cells={window.cells}
            mealCountByDate={mealCountByDate}
            onPressCell={(date) =>
              router.push({ pathname: '/(app)/(tabs)/planning/day/[date]', params: { date } })
            }
          />
        )}

        {/* Actions sur la fenetre courante */}
        <View style={styles.actionsRow}>
          <Button
            mode="contained"
            icon="dice-multiple-outline"
            onPress={onGenerateRandom}
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
            onPress={onClearWindow}
            disabled={setMeals.isPending || generateLlm.isPending}
            style={styles.flexBtn}
            contentStyle={styles.btnContent}
          >
            Effacer
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================================
// MonthGrid : 7 colonnes (lun-dim) x 6 lignes
// ============================================================================
function MonthGrid({
  cells,
  refDate,
  mealCountByDate,
  onPressCell,
}: {
  cells: string[];
  refDate: string;
  mealCountByDate: Map<string, number>;
  onPressCell: (date: string) => void;
}) {
  const theme = useTheme();
  const today = todayIso();
  return (
    <View style={styles.monthGrid}>
      {/* Header weekdays */}
      <View style={styles.monthRow}>
        {WEEKDAYS.map((wd) => (
          <View key={wd} style={styles.monthHeaderCell}>
            <Text
              variant="labelSmall"
              style={{
                color: theme.colors.onSurfaceVariant,
                fontWeight: '700',
                letterSpacing: 0.5,
              }}
            >
              {WEEKDAY_LABELS[wd].slice(0, 3).toUpperCase()}
            </Text>
          </View>
        ))}
      </View>
      {/* 6 rows of 7 cells */}
      {Array.from({ length: 6 }).map((_, rowIdx) => {
        const rowCells = cells.slice(rowIdx * 7, rowIdx * 7 + 7);
        const rowKey = rowCells[0] ?? `row-${rowIdx}`;
        return (
          <View key={rowKey} style={styles.monthRow}>
            {rowCells.map((date) => {
              const inMonth = isSameMonth(date, refDate);
              const isToday = date === today;
              const count = mealCountByDate.get(date) ?? 0;
              return (
                <TouchableRipple
                  key={date}
                  onPress={() => onPressCell(date)}
                  borderless
                  style={[
                    styles.monthCell,
                    {
                      backgroundColor: isToday
                        ? theme.colors.primaryContainer
                        : inMonth
                          ? theme.colors.surface
                          : 'transparent',
                    },
                  ]}
                >
                  <View style={styles.monthCellInner}>
                    <Text
                      variant="bodyMedium"
                      style={{
                        fontWeight: isToday ? '800' : '600',
                        color: isToday
                          ? theme.colors.onPrimaryContainer
                          : inMonth
                            ? theme.colors.onSurface
                            : theme.colors.onSurfaceVariant,
                        opacity: inMonth ? 1 : 0.45,
                      }}
                    >
                      {Number(date.slice(8, 10))}
                    </Text>
                    {count > 0 && (
                      <View
                        style={[
                          styles.cellBadge,
                          {
                            backgroundColor: isToday
                              ? theme.colors.onPrimaryContainer
                              : theme.colors.primary,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.cellBadgeText,
                            {
                              color: isToday
                                ? theme.colors.primaryContainer
                                : theme.colors.onPrimary,
                            },
                          ]}
                        >
                          {count}
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableRipple>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

// ============================================================================
// WeekList : 7 lignes verticales avec emoji + nb meals
// ============================================================================
function WeekList({
  cells,
  mealCountByDate,
  onPressCell,
}: {
  cells: string[];
  mealCountByDate: Map<string, number>;
  onPressCell: (date: string) => void;
}) {
  const theme = useTheme();
  const today = todayIso();
  return (
    <View style={{ gap: 6 }}>
      {cells.map((date) => {
        const isToday = date === today;
        const count = mealCountByDate.get(date) ?? 0;
        const wd = WEEKDAYS[(new Date(date).getDay() + 6) % 7] as (typeof WEEKDAYS)[number];
        return (
          <TouchableRipple
            key={date}
            onPress={() => onPressCell(date)}
            borderless
            style={[
              styles.weekRow,
              {
                backgroundColor: isToday ? theme.colors.primaryContainer : theme.colors.surface,
              },
            ]}
          >
            <View style={styles.weekRowInner}>
              <Surface
                elevation={0}
                style={[
                  styles.weekDayBubble,
                  {
                    backgroundColor: isToday
                      ? theme.colors.onPrimaryContainer
                      : theme.colors.surfaceVariant,
                  },
                ]}
              >
                <Text
                  variant="labelSmall"
                  style={{
                    color: isToday ? theme.colors.primaryContainer : theme.colors.onSurfaceVariant,
                    fontWeight: '800',
                  }}
                >
                  {WEEKDAY_LABELS[wd].slice(0, 3).toUpperCase()}
                </Text>
                <Text
                  variant="titleMedium"
                  style={{
                    color: isToday ? theme.colors.primaryContainer : theme.colors.onSurface,
                    fontWeight: '800',
                  }}
                >
                  {Number(date.slice(8, 10))}
                </Text>
              </Surface>
              <View style={{ flex: 1 }}>
                <Text variant="titleMedium" style={{ fontWeight: '700' }}>
                  {WEEKDAY_LABELS[wd]}
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
                >
                  {count === 0
                    ? 'Aucun repas planifie'
                    : `${count} repas planifie${count > 1 ? 's' : ''}`}
                </Text>
              </View>
              <Text style={[styles.weekChevron, { color: theme.colors.onSurfaceVariant }]}>›</Text>
            </View>
          </TouchableRipple>
        );
      })}
    </View>
  );
}

// ============================================================================
// SetupSection (extrait de l'ancien index, identique)
// ============================================================================
function SetupSection({
  mealPlanConfigured,
  dietPlanConfigured,
  mealPlanSummary,
  dietPlanSummary,
  onMealPlanPress,
  onDietPlanPress,
}: {
  mealPlanConfigured: boolean;
  dietPlanConfigured: boolean;
  mealPlanSummary: string | null;
  dietPlanSummary: string | null;
  onMealPlanPress: () => void;
  onDietPlanPress: () => void;
}) {
  const theme = useTheme();

  if (mealPlanConfigured && dietPlanConfigured) {
    return (
      <Surface
        elevation={0}
        style={[styles.compactCard, { backgroundColor: theme.colors.surface }]}
      >
        <View style={styles.compactRow}>
          <View style={styles.compactItem}>
            <Text
              variant="labelSmall"
              style={[styles.compactLabel, { color: theme.colors.onSurfaceVariant }]}
            >
              Semaine type
            </Text>
            <Text variant="bodyMedium" style={styles.compactValue}>
              {mealPlanSummary}
            </Text>
          </View>
          <View style={[styles.compactDivider, { backgroundColor: theme.colors.outlineVariant }]} />
          <View style={styles.compactItem}>
            <Text
              variant="labelSmall"
              style={[styles.compactLabel, { color: theme.colors.onSurfaceVariant }]}
            >
              Plan alimentaire
            </Text>
            <Text variant="bodyMedium" style={styles.compactValue}>
              {dietPlanSummary}
            </Text>
          </View>
        </View>
        <View style={styles.compactActions}>
          <Button mode="text" compact onPress={onMealPlanPress}>
            Semaine type
          </Button>
          <Button mode="text" compact onPress={onDietPlanPress}>
            Plan alimentaire
          </Button>
        </View>
      </Surface>
    );
  }

  const totalSteps = 2;
  const doneSteps = (mealPlanConfigured ? 1 : 0) + (dietPlanConfigured ? 1 : 0);
  const progressPct = (doneSteps / totalSteps) * 100;

  return (
    <Surface elevation={0} style={[styles.setupCard, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.setupHeader}>
        <View style={{ flex: 1 }}>
          <Text variant="titleMedium" style={styles.setupTitle}>
            Configurez votre foyer
          </Text>
          <Text
            variant="bodySmall"
            style={[styles.setupSubtitle, { color: theme.colors.onSurfaceVariant }]}
          >
            Definissez votre rythme de repas pour generer des plannings adaptes.
          </Text>
        </View>
        <View style={styles.setupProgressBlock}>
          <Text
            variant="labelMedium"
            style={[styles.setupProgressText, { color: theme.colors.primary }]}
          >
            {doneSteps}/{totalSteps}
          </Text>
        </View>
      </View>
      <View style={[styles.progressBar, { backgroundColor: theme.colors.surfaceVariant }]}>
        <View
          style={[
            styles.progressBarFill,
            { width: `${progressPct}%`, backgroundColor: theme.colors.primary },
          ]}
        />
      </View>
      <View style={styles.stepsList}>
        <SetupStep
          icon="calendar-week"
          title="Semaine type"
          description={
            mealPlanConfigured
              ? (mealPlanSummary ?? 'Configure')
              : 'Quels repas planifier chaque jour de la semaine ?'
          }
          done={mealPlanConfigured}
          required
          onPress={onMealPlanPress}
        />
        <SetupStep
          icon="leaf"
          title="Plan alimentaire"
          description={
            dietPlanConfigured
              ? (dietPlanSummary ?? 'Configure')
              : 'Composants attendus (legumes, proteine, feculents...)'
          }
          done={dietPlanConfigured}
          required={false}
          locked={!mealPlanConfigured}
          onPress={onDietPlanPress}
        />
      </View>
    </Surface>
  );
}

function SetupStep({
  icon,
  title,
  description,
  done,
  required,
  locked,
  onPress,
}: {
  icon: string;
  title: string;
  description: string;
  done: boolean;
  required: boolean;
  locked?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const bubbleColor = done
    ? theme.colors.primary
    : locked
      ? theme.colors.surfaceVariant
      : theme.colors.primaryContainer;
  const iconColor = done
    ? theme.colors.onPrimary
    : locked
      ? theme.colors.onSurfaceVariant
      : theme.colors.primary;

  return (
    <TouchableRipple
      onPress={locked ? undefined : onPress}
      disabled={locked}
      borderless
      style={[styles.step, locked && styles.stepLocked]}
    >
      <View style={styles.stepInner}>
        <View style={[styles.stepBubble, { backgroundColor: bubbleColor }]}>
          {done ? (
            <Text style={[styles.stepCheck, { color: iconColor }]}>✓</Text>
          ) : (
            <IconButton
              icon={locked ? 'lock-outline' : icon}
              size={18}
              iconColor={iconColor}
              style={styles.stepBubbleIcon}
              disabled
            />
          )}
        </View>
        <View style={styles.stepBody}>
          <View style={styles.stepTitleRow}>
            <Text variant="titleSmall" style={styles.stepTitle}>
              {title}
            </Text>
            {!required && !done && (
              <Text
                variant="labelSmall"
                style={[styles.stepBadge, { color: theme.colors.onSurfaceVariant }]}
              >
                Optionnel
              </Text>
            )}
            {done && (
              <Text
                variant="labelSmall"
                style={[styles.stepBadge, { color: theme.colors.primary, fontWeight: '700' }]}
              >
                Pret
              </Text>
            )}
          </View>
          <Text
            variant="bodySmall"
            numberOfLines={2}
            style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
          >
            {description}
          </Text>
        </View>
        {!locked && (
          <Text style={[styles.stepChevron, { color: theme.colors.onSurfaceVariant }]}>›</Text>
        )}
      </View>
    </TouchableRipple>
  );
}

// ============================================================================
// Helpers
// ============================================================================
function addDaysSafe(s: string, n: number): string {
  // Reimplem simple pour eviter d'importer addDays (deja importable, mais ce
  // composant n'a besoin que de cette mini fonction quand viewMode = week)
  const d = new Date(`${s}T00:00:00`);
  d.setDate(d.getDate() + n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatRangeLabel(from: string, to: string): string {
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${fmt(f)} → ${fmt(t)}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { padding: 16, gap: 14, paddingBottom: 32 },
  header: { gap: 2, paddingTop: 4 },
  title: { fontWeight: '700' },

  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -4,
  },
  navLabel: { textAlign: 'center', fontWeight: '700' },

  loaderRow: { padding: 20, alignItems: 'center' },

  // Month grid
  monthGrid: { gap: 4 },
  monthRow: { flexDirection: 'row', gap: 4 },
  monthHeaderCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  monthCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  monthCellInner: {
    flex: 1,
    padding: 6,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cellBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
  },
  cellBadgeText: { fontSize: 10, fontWeight: '800' },

  // Week list
  weekRow: { borderRadius: 14, padding: 10 },
  weekRowInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  weekDayBubble: {
    width: 56,
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  },
  weekChevron: { fontSize: 24, paddingHorizontal: 4 },

  // Actions row
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  flexBtn: { flex: 1, borderRadius: 12 },
  btnContent: { paddingVertical: 4 },

  // SetupSection (copie de l'ancien index)
  setupCard: { padding: 16, borderRadius: 18, gap: 12 },
  setupHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  setupTitle: { fontWeight: '700' },
  setupSubtitle: { marginTop: 4, lineHeight: 18 },
  setupProgressBlock: { minWidth: 36, alignItems: 'flex-end' },
  setupProgressText: { fontWeight: '800', fontSize: 14 },
  progressBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 3 },
  stepsList: { gap: 4, marginTop: 4 },
  step: { borderRadius: 12 },
  stepLocked: { opacity: 0.55 },
  stepInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  stepBubble: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBubbleIcon: { margin: 0 },
  stepCheck: { fontSize: 18, fontWeight: '800' },
  stepBody: { flex: 1 },
  stepTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepTitle: { fontWeight: '700' },
  stepBadge: { fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' },
  stepChevron: { fontSize: 22, lineHeight: 22, paddingHorizontal: 4 },
  compactCard: { padding: 14, borderRadius: 16, gap: 8 },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  compactItem: { flex: 1 },
  compactLabel: { letterSpacing: 0.5, textTransform: 'uppercase', fontSize: 10 },
  compactValue: { fontWeight: '700', marginTop: 2 },
  compactDivider: { width: 1, height: 32 },
  compactActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 4, marginTop: 4 },
});
