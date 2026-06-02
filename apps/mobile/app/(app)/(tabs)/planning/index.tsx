import { SetupChip } from '@/components/SetupChip';
import { Topbar } from '@/components/Topbar';
import { useMyDietPlan } from '@/hooks/useDietPlans';
import {
  useCreateMealPlanRange,
  useGeneratePlanningWithLlm,
  useMealPlan,
  useMealPlanRanges,
  useMealsRange,
  useSetMealsRange,
} from '@/hooks/usePlannings';
import { useRecipes } from '@/hooks/useRecipes';
import { ApiError } from '@/lib/api';
import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  addDays,
  addMonths,
  formatMonthYear,
  isSameMonth,
  monthGrid,
  startOfWeek,
  todayIso,
  weekDates,
} from '@/lib/dates';
import { haptics } from '@/lib/haptics';
import { generatePlanningMeals } from '@/lib/planningGenerator';
import { useActiveHousehold } from '@/stores/activeHousehold';
import { type MealPlanRange, findCoveredSlots } from '@mealendar/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Dimensions, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  ActivityIndicator,
  Button,
  Dialog,
  IconButton,
  Menu,
  Portal,
  Surface,
  Text,
  TextInput,
  TouchableRipple,
  useTheme,
} from 'react-native-paper';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type ViewMode = 'month' | 'week';

export default function PlanningIndexScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Hauteur du tabbar du bas (cf. apps/mobile/app/(app)/(tabs)/_layout.tsx)
  const tabBarHeight = 56 + Math.max(insets.bottom, 8);
  const householdId = useActiveHousehold((s) => s.householdId);
  const mealPlan = useMealPlan(householdId);
  const myDietPlan = useMyDietPlan(householdId);
  const recipes = useRecipes(householdId);

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  /** Date de reference pour calculer la fenetre affichee. */
  const [refDate, setRefDate] = useState<string>(todayIso());
  const [modeMenuOpen, setModeMenuOpen] = useState(false);

  // ---------------------------------------------------------------------------
  // Selection de plage : long-press sur une cellule pose rangeStart, le tap
  // suivant determine la 2e borne et navigue vers /planning/range/from/to
  // (vue d'edition multi-jours). Pas d'etat 'range complet' ici : la sortie
  // se fait par navigation.
  // ---------------------------------------------------------------------------
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  /**
   * Quand l'utilisateur a tape la 2e cellule, on stocke le range complet ici
   * et on ouvre une modale de nom. La plage n'est creee qu'a la validation
   * de la modale.
   */
  const [pendingRange, setPendingRange] = useState<{ from: string; to: string } | null>(null);
  const [pendingName, setPendingName] = useState('');

  const clearRange = () => setRangeStart(null);

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

  const ranges = useMealPlanRanges(householdId, window.from, window.to);
  const createRange = useCreateMealPlanRange();

  /**
   * Helper : pour une date donnee, retourne la plage qui la contient (la
   * premiere plage qui matche si plusieurs se chevauchent), ou null.
   */
  const getRangeForDate = (date: string) => {
    for (const r of ranges.data ?? []) {
      if (date >= r.dateFrom && date <= r.dateTo) return r;
    }
    return null;
  };

  // ---------------------------------------------------------------------------
  // Handlers de cellule
  // ---------------------------------------------------------------------------
  const onCellLongPress = (date: string) => {
    haptics.medium();
    setRangeStart(date);
  };

  /**
   * Tap sur cellule :
   *  - si on est en mode range (rangeStart pose) : on cree une plage persistee
   *    [min(start, date), max(start, date)] et on navigue vers la vue range.
   *  - si la date appartient deja a une plage existante : on ouvre la vue
   *    range de cette plage.
   *  - sinon : on ouvre la vue jour.
   */
  const onCellTap = async (date: string) => {
    if (rangeStart) {
      const a = rangeStart <= date ? rangeStart : date;
      const b = rangeStart <= date ? date : rangeStart;
      setRangeStart(null);
      haptics.light();
      // Ouvre la modale de nom plutot que de creer immediatement
      setPendingRange({ from: a, to: b });
      setPendingName(`Plage du ${formatDdMm(a)}`);
      return;
    }
    const existing = getRangeForDate(date);
    if (existing) {
      router.push(`/(app)/(tabs)/planning/range/${existing.dateFrom}/${existing.dateTo}`);
      return;
    }
    router.push(`/(app)/(tabs)/planning/day/${date}`);
  };

  /**
   * Validation de la modale de nom : cree la plage en DB puis navigue vers
   * la vue range.
   */
  const onConfirmRange = async () => {
    if (!pendingRange || !householdId) return;
    const { from, to } = pendingRange;
    const name = pendingName.trim() || `Plage du ${formatDdMm(from)}`;
    setPendingRange(null);
    setPendingName('');
    try {
      await createRange.mutateAsync({
        householdId,
        name,
        dateFrom: from,
        dateTo: to,
      });
    } catch (e) {
      console.warn('[planning] create range failed', e);
    }
    router.push(`/(app)/(tabs)/planning/range/${from}/${to}`);
  };

  const onCancelRange = () => {
    setPendingRange(null);
    setPendingName('');
  };

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

  // ---------------------------------------------------------------------------
  // Animation slide horizontale (reanimated + gesture-handler)
  //
  // Carousel : on rend 3 mois cote a cote (-1, 0, +1) dans une Animated.View
  // de largeur 3*screenW. Le wrapper a marginLeft = -screenW pour que la page
  // courante (index 1) soit centree au repos.
  //
  // dragX vaut le delta du doigt pendant le drag. Au release :
  //   - si |dx| > 25% de la largeur : on anime jusqu'au bord, on commit le
  //     state, puis on remet dragX a 0 sans animation (le nouveau carousel
  //     ses 3 mois sont a nouveau autour du nouveau "courant").
  //   - sinon : spring back a 0.
  // ---------------------------------------------------------------------------
  const screenW = Dimensions.get('window').width;
  const dragX = useSharedValue(0);
  const isAnimating = useSharedValue(false);

  const commitChange = (direction: 'prev' | 'next') => {
    haptics.light();
    if (direction === 'prev') onPrev();
    else onNext();
  };

  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-20, 20])
    .onUpdate((ev) => {
      'worklet';
      if (isAnimating.value) return;
      dragX.value = ev.translationX;
    })
    .onEnd((ev) => {
      'worklet';
      if (isAnimating.value) return;
      const threshold = screenW * 0.25;
      if (ev.translationX > threshold) {
        isAnimating.value = true;
        dragX.value = withTiming(screenW, { duration: 220 }, () => {
          dragX.value = 0;
          isAnimating.value = false;
          runOnJS(commitChange)('prev');
        });
      } else if (ev.translationX < -threshold) {
        isAnimating.value = true;
        dragX.value = withTiming(-screenW, { duration: 220 }, () => {
          dragX.value = 0;
          isAnimating.value = false;
          runOnJS(commitChange)('next');
        });
      } else {
        dragX.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  const carouselAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }],
  }));

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
      <Topbar />

      <View style={[styles.container, { paddingBottom: tabBarHeight + 16 }]}>
        <View style={styles.titleRow}>
          <Text variant="titleLarge" style={styles.title}>
            Planning
          </Text>
          <View style={styles.titleRowRight}>
            <Menu
              visible={modeMenuOpen}
              onDismiss={() => setModeMenuOpen(false)}
              anchor={
                <IconButton
                  icon={viewMode === 'month' ? 'view-module-outline' : 'view-week-outline'}
                  size={22}
                  onPress={() => setModeMenuOpen(true)}
                  style={{ margin: 0 }}
                />
              }
            >
              <Menu.Item
                onPress={() => {
                  setViewMode('week');
                  setModeMenuOpen(false);
                }}
                title="Semaine"
                leadingIcon="view-week-outline"
                titleStyle={
                  viewMode === 'week'
                    ? { color: theme.colors.primary, fontWeight: '700' }
                    : undefined
                }
              />
              <Menu.Item
                onPress={() => {
                  setViewMode('month');
                  setModeMenuOpen(false);
                }}
                title="Mois"
                leadingIcon="view-module-outline"
                titleStyle={
                  viewMode === 'month'
                    ? { color: theme.colors.primary, fontWeight: '700' }
                    : undefined
                }
              />
            </Menu>
            <SetupChip
              iconOnly
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
              loading={mealPlan.isPending || myDietPlan.isPending}
            />
          </View>
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

        <GestureDetector gesture={swipeGesture}>
          <Animated.View
            style={[
              styles.carousel,
              carouselAnimatedStyle,
              {
                width: screenW * 3,
                marginLeft: -screenW - 16, // -screenW pour centrer index 1, -16 pour annuler le padding du container
                marginRight: -16,
              },
            ]}
          >
            <CalendarPage
              refDate={shiftRefDate(refDate, viewMode, -1)}
              viewMode={viewMode}
              householdId={householdId}
              mealPlan={mealPlan.data ?? null}
              rangeStart={null}
              onCellTap={onCellTap}
              onCellLongPress={onCellLongPress}
              width={screenW}
            />
            <CalendarPage
              refDate={refDate}
              viewMode={viewMode}
              householdId={householdId}
              mealPlan={mealPlan.data ?? null}
              rangeStart={rangeStart}
              onCellTap={onCellTap}
              onCellLongPress={onCellLongPress}
              width={screenW}
            />
            <CalendarPage
              refDate={shiftRefDate(refDate, viewMode, 1)}
              viewMode={viewMode}
              householdId={householdId}
              mealPlan={mealPlan.data ?? null}
              rangeStart={null}
              onCellTap={onCellTap}
              onCellLongPress={onCellLongPress}
              width={screenW}
            />
          </Animated.View>
        </GestureDetector>

        {/* Aide visuelle quand l'utilisateur a fait long-press sans encore
            avoir tape la 2e cellule */}
        {rangeStart && (
          <Surface
            elevation={0}
            style={[styles.rangeHint, { backgroundColor: theme.colors.secondaryContainer }]}
          >
            <Text variant="bodySmall" style={{ color: theme.colors.onSecondaryContainer, flex: 1 }}>
              Tapez la derniere date de votre plage pour ouvrir la vue d'edition.
            </Text>
            <Button mode="text" compact onPress={clearRange}>
              Annuler
            </Button>
          </Surface>
        )}
      </View>

      {/* Modale de naming a la creation d'une plage */}
      <Portal>
        <Dialog visible={!!pendingRange} onDismiss={onCancelRange}>
          <Dialog.Title>Nommer la plage</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ marginBottom: 12 }}>
              {pendingRange
                ? `${formatDdMm(pendingRange.from)} → ${formatDdMm(pendingRange.to)}`
                : ''}
            </Text>
            <TextInput
              mode="outlined"
              autoFocus
              value={pendingName}
              onChangeText={setPendingName}
              placeholder="Ex. Semaine equilibree"
              maxLength={80}
              onSubmitEditing={onConfirmRange}
              returnKeyType="done"
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={onCancelRange}>Annuler</Button>
            <Button mode="contained" onPress={onConfirmRange} loading={createRange.isPending}>
              Creer
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
}

// ============================================================================
// Helpers pour les bandes de plages dans le calendrier
// ============================================================================

/**
 * Palette de couleurs pour les plages. Hue choisie pour rester lisible
 * sur fond sage/cream + assurer une bonne distinction entre adjacentes.
 */
const RANGE_COLORS: { bg: string; text: string }[] = [
  { bg: '#3F7D58', text: '#FFFFFF' }, // sage primary
  { bg: '#C57148', text: '#FFFFFF' }, // terracotta
  { bg: '#5B7CB1', text: '#FFFFFF' }, // bleu
  { bg: '#B85C7E', text: '#FFFFFF' }, // rose
  { bg: '#8B5CB8', text: '#FFFFFF' }, // violet
  { bg: '#C9A227', text: '#FFFFFF' }, // jaune-or
  { bg: '#5C8B83', text: '#FFFFFF' }, // teal
  { bg: '#A05C3F', text: '#FFFFFF' }, // brun
];

function colorForRange(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const idx = ((hash % RANGE_COLORS.length) + RANGE_COLORS.length) % RANGE_COLORS.length;
  return RANGE_COLORS[idx] as { bg: string; text: string };
}

/**
 * Pour une grille de cells (42 dates lundi-aligne), assigne a chaque plage
 * un index de 'lane' (0, 1, 2...) tel que deux plages chevauchantes ne
 * partagent pas la meme lane. Greedy par date_from.
 *
 * Retourne aussi pour chaque cellule la liste des bandes a afficher,
 * indexees par lane.
 */
type RangeLane = { range: MealPlanRange; lane: number };

function assignRangeLanes(
  ranges: MealPlanRange[],
  windowFrom: string,
  windowTo: string,
): RangeLane[] {
  // Filtre les plages qui chevauchent la fenetre
  const inWindow = ranges.filter((r) => !(r.dateTo < windowFrom || r.dateFrom > windowTo));
  // Tri par date_from puis date_to (asc)
  const sorted = [...inWindow].sort((a, b) => {
    if (a.dateFrom !== b.dateFrom) return a.dateFrom < b.dateFrom ? -1 : 1;
    return a.dateTo < b.dateTo ? -1 : 1;
  });

  /** lane occupee jusqu'a la date YYYY-MM-DD (inclus) */
  const laneEnd: string[] = [];
  const out: RangeLane[] = [];
  for (const r of sorted) {
    let lane = laneEnd.findIndex((endDate) => endDate < r.dateFrom);
    if (lane === -1) {
      lane = laneEnd.length;
    }
    laneEnd[lane] = r.dateTo;
    out.push({ range: r, lane });
  }
  return out;
}

// ============================================================================
// CalendarPage : une "page" du carousel (un mois ou une semaine).
//
// Charge ses propres meals + ranges sur la fenetre calculee depuis refDate.
// Les 3 instances rendues dans le carousel ont des windows differentes,
// React Query met tout en cache pour eviter les appels redondants.
// ============================================================================
function CalendarPage({
  refDate,
  viewMode,
  householdId,
  mealPlan,
  rangeStart,
  onCellTap,
  onCellLongPress,
  width,
}: {
  refDate: string;
  viewMode: ViewMode;
  householdId: string | null;
  mealPlan: { slotConfig: SlotConfig } | null;
  rangeStart: string | null;
  onCellTap: (date: string) => void;
  onCellLongPress: (date: string) => void;
  width: number;
}) {
  const window = useMemo(() => {
    if (viewMode === 'week') {
      const dates = weekDates(refDate);
      return {
        from: dates[0] as string,
        to: dates[dates.length - 1] as string,
        cells: dates,
      };
    }
    const cells = monthGrid(refDate);
    return {
      from: cells[0] as string,
      to: cells[cells.length - 1] as string,
      cells,
    };
  }, [viewMode, refDate]);

  const meals = useMealsRange(householdId, window.from, window.to);
  const ranges = useMealPlanRanges(householdId, window.from, window.to);

  const plannedDays = useMemo(() => {
    const set = new Set<string>();
    const mealsList = meals.data?.meals ?? [];
    for (const m of mealsList) set.add(m.date);
    if (mealPlan) {
      for (const m of mealsList) {
        const cm = m.coversMeals ?? 1;
        if (cm <= 1) continue;
        const covered = findCoveredSlots({
          sourceDate: m.date,
          sourceSlotKey: m.slotKey,
          coversMeals: cm,
          slotConfig: mealPlan.slotConfig,
        });
        for (const c of covered) set.add(c.date);
      }
    }
    return set;
  }, [meals.data, mealPlan]);

  return (
    <View style={{ width, paddingHorizontal: 16 }}>
      {viewMode === 'month' ? (
        <MonthGrid
          cells={window.cells}
          refDate={refDate}
          plannedDays={plannedDays}
          ranges={ranges.data ?? []}
          rangeStart={rangeStart}
          rangeEnd={null}
          onPressCell={onCellTap}
          onLongPressCell={onCellLongPress}
        />
      ) : (
        <WeekList
          cells={window.cells}
          plannedDays={plannedDays}
          ranges={ranges.data ?? []}
          rangeStart={rangeStart}
          rangeEnd={null}
          onPressCell={onCellTap}
          onLongPressCell={onCellLongPress}
        />
      )}
    </View>
  );
}

// Type alias pour le slotConfig (utilise par CalendarPage)
type SlotConfig = Record<string, { key: string; time?: string }[]>;

// ============================================================================
// MonthGrid : 7 colonnes (lun-dim) x 6 lignes
// ============================================================================
function MonthGrid({
  cells,
  refDate,
  plannedDays,
  ranges,
  rangeStart,
  rangeEnd,
  onPressCell,
  onLongPressCell,
}: {
  cells: string[];
  refDate: string;
  plannedDays: Set<string>;
  ranges: MealPlanRange[];
  rangeStart: string | null;
  rangeEnd: string | null;
  onPressCell: (date: string) => void;
  onLongPressCell: (date: string) => void;
}) {
  const theme = useTheme();
  const today = todayIso();
  const rangeFrom =
    rangeStart && rangeEnd ? (rangeStart <= rangeEnd ? rangeStart : rangeEnd) : rangeStart;
  const rangeTo = rangeStart && rangeEnd ? (rangeStart <= rangeEnd ? rangeEnd : rangeStart) : null;
  const isInRange = (date: string) => {
    if (!rangeFrom) return false;
    if (!rangeTo) return date === rangeFrom;
    return date >= rangeFrom && date <= rangeTo;
  };

  const windowFrom = cells[0] ?? '';
  const windowTo = cells[cells.length - 1] ?? '';
  const lanes = useMemo(
    () => assignRangeLanes(ranges, windowFrom, windowTo),
    [ranges, windowFrom, windowTo],
  );

  /**
   * Pour une rangee donnee (7 dates consecutives), calcule la liste des
   * 'segments' de bandes a dessiner en overlay. Chaque segment correspond
   * a la portion d'une plage qui chevauche cette rangee.
   *
   * Un segment retourne :
   *  - range
   *  - lane (0..n)
   *  - startCol (0..6) : 1ere colonne occupee dans la rangee
   *  - spanCols (1..7) : nb de colonnes consecutives
   *  - showLabel : true si le label doit etre affiche (1ere occurrence
   *    visible dans la rangee, ou 1er jour de la plage)
   */
  type Segment = {
    rangeId: string;
    name: string;
    color: { bg: string; text: string };
    lane: number;
    startCol: number;
    spanCols: number;
    showLabel: boolean;
  };
  const segmentsForRow = (rowCells: string[]): Segment[] => {
    const rowFrom = rowCells[0] ?? '';
    const rowTo = rowCells[rowCells.length - 1] ?? '';
    const out: Segment[] = [];
    for (const { range, lane } of lanes) {
      if (range.dateTo < rowFrom || range.dateFrom > rowTo) continue;
      const segStart = range.dateFrom > rowFrom ? range.dateFrom : rowFrom;
      const segEnd = range.dateTo < rowTo ? range.dateTo : rowTo;
      const startCol = rowCells.indexOf(segStart);
      const endCol = rowCells.indexOf(segEnd);
      if (startCol === -1 || endCol === -1) continue;
      out.push({
        rangeId: range.id,
        name: range.name,
        color: colorForRange(range.name),
        lane,
        startCol,
        spanCols: endCol - startCol + 1,
        // Affiche le label sur le 1er segment de la rangee (qui est aussi
        // souvent le debut de la plage ou le lundi pour une plage qui
        // continue depuis la rangee precedente).
        showLabel: true,
      });
    }
    return out;
  };

  const MAX_LANES_VISIBLE = 3;
  const BAND_HEIGHT = 18;
  const BAND_GAP = 3;
  const BAND_TOP = 26; // espace reserve au numero du jour

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
        const segments = segmentsForRow(rowCells);
        const visibleSegments = segments.filter((s) => s.lane < MAX_LANES_VISIBLE);
        // Pour chaque colonne, compte les overflow de plages au-dela des lanes visibles
        const overflowByCol = new Array(7).fill(0);
        for (const s of segments) {
          if (s.lane < MAX_LANES_VISIBLE) continue;
          for (let c = s.startCol; c < s.startCol + s.spanCols; c++) {
            overflowByCol[c] = (overflowByCol[c] ?? 0) + 1;
          }
        }
        return (
          <View key={rowKey} style={styles.monthRowWrapper}>
            <View style={[styles.monthRow, { flex: 1 }]}>
              {rowCells.map((date) => {
                const inMonth = isSameMonth(date, refDate);
                const isToday = date === today;
                const isPast = date < today;
                const isPlanned = plannedDays.has(date);
                const inSel = isInRange(date);
                return (
                  <TouchableRipple
                    key={date}
                    onPress={() => onPressCell(date)}
                    onLongPress={() => onLongPressCell(date)}
                    borderless
                    style={[
                      styles.monthCell,
                      {
                        backgroundColor: inSel
                          ? theme.colors.tertiaryContainer
                          : isToday
                            ? theme.colors.primaryContainer
                            : inMonth
                              ? theme.colors.surface
                              : 'transparent',
                        borderWidth: inSel ? 1.5 : 0,
                        borderColor: inSel ? theme.colors.tertiary : 'transparent',
                        opacity: !inMonth ? 0.45 : isPast && !isToday ? 0.55 : 1,
                      },
                    ]}
                  >
                    <View style={styles.monthCellInner}>
                      <View style={styles.monthCellTopRow}>
                        <Text
                          variant="bodyMedium"
                          style={{
                            fontWeight: isToday || inSel ? '800' : '600',
                            color: inSel
                              ? theme.colors.onTertiaryContainer
                              : isToday
                                ? theme.colors.onPrimaryContainer
                                : inMonth
                                  ? theme.colors.onSurface
                                  : theme.colors.onSurfaceVariant,
                          }}
                        >
                          {Number(date.slice(8, 10))}
                        </Text>
                        {isPlanned && (
                          <View
                            style={[
                              styles.cellDot,
                              {
                                backgroundColor: inSel
                                  ? theme.colors.tertiary
                                  : isToday
                                    ? theme.colors.onPrimaryContainer
                                    : theme.colors.primary,
                              },
                            ]}
                          />
                        )}
                      </View>
                      {/* Compteur d'overflow (rendu DANS la cellule pour
                          rester aligne avec la colonne, sous les bandes) */}
                      {overflowByCol[rowCells.indexOf(date)] > 0 && (
                        <Text
                          variant="labelSmall"
                          style={[styles.bandsOverflow, { color: theme.colors.onSurfaceVariant }]}
                        >
                          +{overflowByCol[rowCells.indexOf(date)]}
                        </Text>
                      )}
                    </View>
                  </TouchableRipple>
                );
              })}
            </View>
            {/* Overlay : bandes continues qui s'etalent sur plusieurs cellules.
                pointerEvents=box-none laisse les taps passer aux cellules
                en-dessous, sauf sur les bandes elles-memes. */}
            <View style={styles.bandsOverlay} pointerEvents="box-none">
              {visibleSegments.map((s) => (
                <TouchableRipple
                  key={`${s.rangeId}-${s.startCol}`}
                  onPress={() => {
                    // Tap sur une bande : ouvre la vue range de cette plage.
                    const r = ranges.find((x) => x.id === s.rangeId);
                    if (r) router.push(`/(app)/(tabs)/planning/range/${r.dateFrom}/${r.dateTo}`);
                  }}
                  borderless
                  style={[
                    styles.band,
                    {
                      backgroundColor: s.color.bg,
                      left: `${(s.startCol / 7) * 100}%`,
                      width: `${(s.spanCols / 7) * 100}%`,
                      top: BAND_TOP + s.lane * (BAND_HEIGHT + BAND_GAP),
                      height: BAND_HEIGHT,
                    },
                  ]}
                >
                  {s.showLabel ? (
                    <Text numberOfLines={1} style={[styles.bandText, { color: s.color.text }]}>
                      {s.name}
                    </Text>
                  ) : (
                    <View />
                  )}
                </TouchableRipple>
              ))}
            </View>
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
  plannedDays,
  ranges,
  rangeStart,
  rangeEnd,
  onPressCell,
  onLongPressCell,
}: {
  cells: string[];
  plannedDays: Set<string>;
  ranges: MealPlanRange[];
  rangeStart: string | null;
  rangeEnd: string | null;
  onPressCell: (date: string) => void;
  onLongPressCell: (date: string) => void;
}) {
  const theme = useTheme();
  const today = todayIso();
  const rangeFrom =
    rangeStart && rangeEnd ? (rangeStart <= rangeEnd ? rangeStart : rangeEnd) : rangeStart;
  const rangeTo = rangeStart && rangeEnd ? (rangeStart <= rangeEnd ? rangeEnd : rangeStart) : null;
  const isInRange = (date: string) => {
    if (!rangeFrom) return false;
    if (!rangeTo) return date === rangeFrom;
    return date >= rangeFrom && date <= rangeTo;
  };
  const rangesForDate = (date: string) =>
    ranges.filter((r) => date >= r.dateFrom && date <= r.dateTo);

  return (
    <View style={{ flex: 1, gap: 6 }}>
      {cells.map((date) => {
        const isToday = date === today;
        const isPast = date < today;
        const isPlanned = plannedDays.has(date);
        const wd = WEEKDAYS[(new Date(date).getDay() + 6) % 7] as (typeof WEEKDAYS)[number];
        const inSel = isInRange(date);
        const dayRanges = rangesForDate(date);
        return (
          <TouchableRipple
            key={date}
            onPress={() => onPressCell(date)}
            onLongPress={() => onLongPressCell(date)}
            borderless
            style={[
              styles.weekRow,
              {
                backgroundColor: inSel
                  ? theme.colors.tertiaryContainer
                  : isToday
                    ? theme.colors.primaryContainer
                    : isPlanned
                      ? theme.colors.primaryContainer
                      : theme.colors.surface,
                borderWidth: inSel ? 1.5 : 0,
                borderColor: inSel ? theme.colors.tertiary : 'transparent',
                opacity: isPast && !isToday ? 0.55 : 1,
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
                  {isPlanned ? 'Repas planifies' : 'Aucun repas planifie'}
                </Text>
                {dayRanges.length > 0 && (
                  <View style={styles.weekRangesRow}>
                    {dayRanges.map((r) => {
                      const color = colorForRange(r.name);
                      return (
                        <View
                          key={r.id}
                          style={[styles.weekRangeChip, { backgroundColor: color.bg }]}
                        >
                          <Text
                            numberOfLines={1}
                            style={[styles.weekRangeChipText, { color: color.text }]}
                          >
                            {r.name}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                )}
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
  return `${formatDdMm(from)} → ${formatDdMm(to)}`;
}

function formatDdMm(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Decale la refDate d'une "page" complete selon le mode :
 *  - month : ±1 mois
 *  - week  : ±7 jours
 */
function shiftRefDate(refDate: string, viewMode: ViewMode, direction: -1 | 1): string {
  if (viewMode === 'week') return addDays(refDate, direction * 7);
  return addMonths(refDate, direction);
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  titleRowRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { fontWeight: '700' },

  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -8,
    marginBottom: -4,
  },
  navLabel: { textAlign: 'center', fontWeight: '700' },

  loaderRow: { padding: 20, alignItems: 'center' },
  swipeArea: { flex: 1 },
  carousel: {
    flex: 1,
    flexDirection: 'row',
    // marginLeft: -screenW est applique dynamiquement via style inline pour
    // que la page centrale (index 1) soit centree sur l'ecran au repos.
  },

  // Month grid : prend tout l'espace vertical disponible
  monthGrid: { flex: 1, gap: 1 },
  monthRow: { flexDirection: 'row', gap: 0 },
  monthHeaderCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 2,
  },
  monthCell: {
    flex: 1,
    borderRadius: 0,
  },
  monthCellInner: {
    flex: 1,
    paddingTop: 4,
    paddingHorizontal: 2,
    paddingBottom: 2,
  },
  monthCellTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  cellDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  // Wrapper d'une rangee : permet l'overlay absolu des bandes par-dessus
  // les cellules. Position relative pour ancrer l'overlay. Flex 1 pour que
  // les 6 rangees se repartissent l'espace vertical disponible. maxHeight
  // pour eviter des cellules trop beantes sur grand ecran.
  monthRowWrapper: { position: 'relative', flex: 1, maxHeight: 100 },
  bandsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  band: {
    position: 'absolute',
    borderRadius: 3,
    paddingHorizontal: 4,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bandText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },
  bandsOverflow: { fontSize: 10, fontWeight: '700', alignSelf: 'flex-end', paddingTop: 2 },

  // Week list
  weekRow: {
    flex: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  weekRowInner: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  weekDayBubble: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  },
  weekChevron: { fontSize: 24, paddingHorizontal: 4, alignSelf: 'center' },
  weekRangesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  weekRangeChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, maxWidth: 160 },
  weekRangeChipText: { fontSize: 11, fontWeight: '700' },

  // Actions row
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  flexBtn: { flex: 1, borderRadius: 12 },
  btnContent: { paddingVertical: 4 },

  // Hint quand long-press en cours (selection en attente du 2e tap)
  rangeHint: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 8,
  },
});
