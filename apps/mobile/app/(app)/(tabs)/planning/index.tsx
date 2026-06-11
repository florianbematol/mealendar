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
import { type MealPlanRange, type PlannedMeal, findCoveredSlots } from '@mealendar/shared';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type ViewMode = 'month' | 'week';

// Carousel : 11 pages mountees au demarrage (5 avant + courant + 5 apres).
// On etend la liste quand on s'approche d'un bord ; ce buffer reduit les
// remounts. La virtualisation (rendu seulement de +/-1 page) limite le cout.
const INITIAL_PAGE_COUNT = 11;
const INITIAL_CURRENT = Math.floor(INITIAL_PAGE_COUNT / 2);
const EXTEND_THRESHOLD = 2; // anticipe l'extension 2 pages avant le bord

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
  const [modeMenuOpen, setModeMenuOpen] = useState(false);

  // ---------------------------------------------------------------------------
  // Carousel infini : on maintient une liste de "pages" (refDates) et un
  // index courant. Quand l'utilisateur swipe, on incremente/decremente
  // l'index. Quand l'index approche d'un bord, on etend la liste
  // silencieusement (en ajoutant un mois en debut/fin et en re-ajustant
  // l'index si necessaire).
  //
  // Le translateX du carousel est calcule en derive : -currentIndex*screenW
  // + dragX (le delta du doigt pendant le drag). Au commit (apres animation
  // de fin de swipe), on incremente currentIndex et on remet dragX a 0
  // SIMULTANEMENT, ce qui rend le repositionnement invisible (pas de flicker).
  // ---------------------------------------------------------------------------

  const [pages, setPages] = useState<string[]>(() =>
    Array.from({ length: INITIAL_PAGE_COUNT }, (_, i) =>
      shiftRefDate(todayIso(), 'month', i - INITIAL_CURRENT),
    ),
  );
  const [currentIndex, setCurrentIndex] = useState(INITIAL_CURRENT);

  /** Date de reference pour calculer la fenetre affichee. */
  const refDate = pages[currentIndex] ?? todayIso();

  // Quand on bascule month <-> week, le step entre pages change (1 mois vs 7
  // jours). On regenere la liste centree sur la refDate courante avec le
  // nouveau step. Ne touche pas a refDate elle-meme.
  // biome-ignore lint/correctness/useExhaustiveDependencies: viewMode is the trigger
  useEffect(() => {
    setPages(
      Array.from({ length: INITIAL_PAGE_COUNT }, (_, i) =>
        shiftRefDate(refDate, viewMode, i - INITIAL_CURRENT),
      ),
    );
    setCurrentIndex(INITIAL_CURRENT);
    // dragX et translateX sont reset via le re-render naturel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

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
  // Fenetre globale du carousel : couvre toutes les pages mountees, du
  // premier jour de la 1ere page au dernier de la derniere. On fetch
  // meals + ranges UNE SEULE FOIS pour toute cette fenetre, puis on filtre
  // dans chaque CalendarPage. Evite N requetes parallèles, et garantit
  // que les pages voisines ont deja les donnees quand on swipe vers elles.
  // ---------------------------------------------------------------------------
  const globalWindow = useMemo(() => {
    if (pages.length === 0) {
      return { from: refDate, to: refDate };
    }
    const firstPage = pages[0] as string;
    const lastPage = pages[pages.length - 1] as string;
    if (viewMode === 'week') {
      const firstDates = weekDates(firstPage);
      const lastDates = weekDates(lastPage);
      return {
        from: firstDates[0] as string,
        to: lastDates[lastDates.length - 1] as string,
      };
    }
    const firstCells = monthGrid(firstPage);
    const lastCells = monthGrid(lastPage);
    return {
      from: firstCells[0] as string,
      to: lastCells[lastCells.length - 1] as string,
    };
  }, [pages, viewMode, refDate]);

  const meals = useMealsRange(householdId, globalWindow.from, globalWindow.to);
  const ranges = useMealPlanRanges(householdId, globalWindow.from, globalWindow.to);
  const createRange = useCreateMealPlanRange();

  // ---------------------------------------------------------------------------
  // Handlers de cellule
  //
  // Stabilises avec useCallback + une ref pour les valeurs mutables
  // (rangeStart, ranges) afin de ne JAMAIS recreer les callbacks. Ca permet
  // a React.memo(CalendarPage/MonthGrid) de fonctionner et d'eviter les
  // re-rendus inutiles de toutes les grilles a chaque changement de state.
  // ---------------------------------------------------------------------------
  const handlersStateRef = useRef({ rangeStart, rangesData: ranges.data, householdId });
  handlersStateRef.current = { rangeStart, rangesData: ranges.data, householdId };

  const onCellLongPress = useCallback((date: string) => {
    haptics.medium();
    setRangeStart(date);
  }, []);

  const onCellTap = useCallback((date: string) => {
    const { rangeStart: rs, rangesData } = handlersStateRef.current;
    if (rs) {
      const a = rs <= date ? rs : date;
      const b = rs <= date ? date : rs;
      setRangeStart(null);
      haptics.light();
      setPendingRange({ from: a, to: b });
      setPendingName(`Plage du ${formatDdMm(a)}`);
      return;
    }
    const existing = (rangesData ?? []).find((r) => date >= r.dateFrom && date <= r.dateTo);
    if (existing) {
      router.push(`/(app)/(tabs)/planning/range/${existing.dateFrom}/${existing.dateTo}`);
      return;
    }
    router.push(`/(app)/(tabs)/planning/day/${date}`);
  }, []);

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
  // Animation slide horizontale (reanimated + gesture-handler)
  //
  // Vrai carousel infini : pages[currentIndex] est centre, dragX est le delta
  // du doigt pendant le drag. translateX = -currentIndex*screenW + dragX
  // (calcule via useDerivedValue, donc toujours coherent).
  //
  // Au commit (apres animation slide vers le bord), on incremente
  // currentIndex (state JS) ET on remet dragX a 0 dans la meme tick. La
  // formule donne le meme translateX final, donc aucun flicker visible.
  //
  // Quand currentIndex approche d'un bord (< EXTEND_THRESHOLD), on etend
  // silencieusement la liste pages en ajoutant une page au debut/fin et en
  // ajustant currentIndex pour compenser le shift.
  // ---------------------------------------------------------------------------
  const screenW = Dimensions.get('window').width;
  const dragX = useSharedValue(0);
  /**
   * Mirror du currentIndex en SharedValue pour pouvoir le lire dans un
   * worklet (useDerivedValue) sans warning "Reading from value during render".
   * On le synchronise via un useEffect a chaque changement de state JS.
   */
  const currentIndexSV = useSharedValue(INITIAL_CURRENT);
  const isAnimating = useSharedValue(false);

  // Synchronise currentIndexSV avec le state JS apres chaque commit React.
  useEffect(() => {
    currentIndexSV.value = currentIndex;
  }, [currentIndex, currentIndexSV]);

  // Etend la liste pages si on est trop pres d'un bord. Reagit au
  // changement de currentIndex (apres un swipe). Ecriture des SharedValues
  // dans le useEffect (post-render), pas dans le commit React.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pages/viewMode lus mais pas dans les deps pour eviter une boucle
  useEffect(() => {
    if (currentIndex <= EXTEND_THRESHOLD) {
      // Manque de pages a gauche : on prepend une page
      const first = pages[0] ?? todayIso();
      const newPage = shiftRefDate(first, viewMode, -1);
      setPages([newPage, ...pages]);
      // currentIndex doit etre incremente de 1 pour pointer sur la meme page.
      // dragX += screenW pour que translateX = -(idx+1)*W + (dragX+W) reste
      // identique a -idx*W + dragX (aucun mouvement visible).
      const newIdx = currentIndex + 1;
      currentIndexSV.value = newIdx;
      dragX.value += screenW;
      setCurrentIndex(newIdx);
    } else if (currentIndex >= pages.length - 1 - EXTEND_THRESHOLD) {
      // Manque de pages a droite : append. currentIndex inchange.
      const last = pages[pages.length - 1] ?? todayIso();
      const newPage = shiftRefDate(last, viewMode, 1);
      setPages([...pages, newPage]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  const commitChange = (direction: 'prev' | 'next') => {
    const newIdx = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    // Met a jour le SharedValue ET le dragX SIMULTANEMENT pour que la
    // formule translateX = -newIdx*W + 0 donne le meme resultat visuel
    // que -oldIdx*W + (±W) avant le commit. Aucun mouvement visible.
    currentIndexSV.value = newIdx;
    dragX.value = 0;
    isAnimating.value = false;
    setCurrentIndex(newIdx);
    // Note : extendPagesIfNeeded est appele via useEffect quand currentIndex
    // change, pour eviter les writes de SharedValue pendant le render.
  };

  // ---------------------------------------------------------------------------
  // Navigation externe (chevrons et "Aujourd'hui") : on appelle commitChange
  // avec une animation pour que le mouvement soit visible. Si la page cible
  // est plus loin qu'un voisin, on saute directement (refDate change, le
  // carousel se reinitialise).
  // ---------------------------------------------------------------------------
  const onPrev = () => {
    if (isAnimating.value) return;
    isAnimating.value = true;
    dragX.value = withTiming(screenW, { duration: 220 }, () => {
      runOnJS(commitChange)('prev');
    });
  };
  const onNext = () => {
    if (isAnimating.value) return;
    isAnimating.value = true;
    dragX.value = withTiming(-screenW, { duration: 220 }, () => {
      runOnJS(commitChange)('next');
    });
  };
  const onToday = useCallback(() => {
    // Saut direct vers today : on regen la liste autour de today
    setPages(
      Array.from({ length: INITIAL_PAGE_COUNT }, (_, i) =>
        shiftRefDate(todayIso(), viewMode, i - INITIAL_CURRENT),
      ),
    );
    setCurrentIndex(INITIAL_CURRENT);
    currentIndexSV.value = INITIAL_CURRENT;
    dragX.value = 0;
  }, [viewMode, currentIndexSV, dragX]);

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
          runOnJS(commitChange)('prev');
        });
      } else if (ev.translationX < -threshold) {
        isAnimating.value = true;
        dragX.value = withTiming(-screenW, { duration: 220 }, () => {
          runOnJS(commitChange)('next');
        });
      } else {
        dragX.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  // translateX permanent : -currentIndex*W + dragX. Recompute en worklet
  // a chaque frame pour suivre dragX. On lit currentIndexSV (SharedValue)
  // au lieu du state JS pour eviter le warning Reanimated et garantir la
  // synchro thread UI.
  const translateX = useDerivedValue(() => -currentIndexSV.value * screenW + dragX.value);

  const carouselAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

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

        <GestureDetector gesture={swipeGesture}>
          <Animated.View
            style={[
              styles.carousel,
              carouselAnimatedStyle,
              {
                // Largeur totale = N pages * largeur ecran. Le translateX
                // s'occupe du positionnement (negatif = la page courante
                // est a l'ecran).
                width: screenW * pages.length,
                // -16 pour annuler le paddingHorizontal du container parent
                // afin que les pages remplissent vraiment l'ecran.
                marginLeft: -16,
                marginRight: -16,
              },
            ]}
          >
            {pages.map((pageDate, idx) => {
              // Virtualisation : on ne rend la grille complete que pour les
              // pages proches du currentIndex (courante + 1 de chaque cote).
              // Les autres sont des placeholders vides de meme largeur, ce
              // qui evite de monter 11*42 cellules d'un coup.
              const isVisible = Math.abs(idx - currentIndex) <= 1;
              if (!isVisible) {
                return <View key={pageDate} style={{ width: screenW }} />;
              }
              return (
                <CalendarPage
                  key={pageDate}
                  refDate={pageDate}
                  viewMode={viewMode}
                  mealPlan={mealPlan.data ?? null}
                  rangeStart={idx === currentIndex ? rangeStart : null}
                  allMeals={meals.data?.meals ?? []}
                  allRanges={ranges.data ?? []}
                  onCellTap={onCellTap}
                  onCellLongPress={onCellLongPress}
                  onTodayPress={onToday}
                  width={screenW}
                />
              );
            })}
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
const CalendarPage = memo(function CalendarPage({
  refDate,
  viewMode,
  mealPlan,
  rangeStart,
  allMeals,
  allRanges,
  onCellTap,
  onCellLongPress,
  onTodayPress,
  width,
}: {
  refDate: string;
  viewMode: ViewMode;
  mealPlan: { slotConfig: SlotConfig } | null;
  rangeStart: string | null;
  /** Meals globaux (toute la fenetre du carousel). On filtre cote page. */
  allMeals: PlannedMeal[];
  /** Plages globales. On filtre cote page. */
  allRanges: MealPlanRange[];
  onCellTap: (date: string) => void;
  onCellLongPress: (date: string) => void;
  onTodayPress: () => void;
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

  // Filtre les meals/ranges sur la fenetre de la page (sous-ensemble des
  // donnees globales chargees au parent).
  const pageMeals = useMemo(
    () => allMeals.filter((m) => m.date >= window.from && m.date <= window.to),
    [allMeals, window.from, window.to],
  );
  const pageRanges = useMemo(
    () => allRanges.filter((r) => !(r.dateTo < window.from || r.dateFrom > window.to)),
    [allRanges, window.from, window.to],
  );

  const plannedDays = useMemo(() => {
    const set = new Set<string>();
    for (const m of pageMeals) set.add(m.date);
    if (mealPlan) {
      for (const m of pageMeals) {
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
  }, [pageMeals, mealPlan]);

  const headerLabel =
    viewMode === 'week'
      ? `${formatDdMm(window.from)} → ${formatDdMm(window.to)}`
      : formatMonthYear(refDate);

  return (
    <View style={{ width, paddingHorizontal: 16, height: '100%' }}>
      <TouchableRipple
        onPress={onTodayPress}
        borderless
        style={{ alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 6, marginBottom: 4 }}
      >
        <Text variant="titleMedium" style={{ fontWeight: '700' }}>
          {headerLabel}
        </Text>
      </TouchableRipple>
      {viewMode === 'month' ? (
        <MonthGrid
          cells={window.cells}
          refDate={refDate}
          plannedDays={plannedDays}
          ranges={pageRanges}
          rangeStart={rangeStart}
          rangeEnd={null}
          onPressCell={onCellTap}
          onLongPressCell={onCellLongPress}
        />
      ) : (
        <WeekList
          cells={window.cells}
          plannedDays={plannedDays}
          ranges={pageRanges}
          rangeStart={rangeStart}
          rangeEnd={null}
          onPressCell={onCellTap}
          onLongPressCell={onCellLongPress}
        />
      )}
    </View>
  );
});

// Type alias pour le slotConfig (utilise par CalendarPage)
type SlotConfig = Record<string, { key: string; time?: string }[]>;

// ============================================================================
// MonthGrid : 7 colonnes (lun-dim) x 6 lignes
// ============================================================================
const MonthGrid = memo(function MonthGrid({
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
});

// ============================================================================
// WeekList : 7 lignes verticales avec emoji + nb meals
// ============================================================================
const WeekList = memo(function WeekList({
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
});

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
function shiftRefDate(refDate: string, viewMode: ViewMode, offset: number): string {
  if (viewMode === 'week') return addDays(refDate, offset * 7);
  return addMonths(refDate, offset);
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
