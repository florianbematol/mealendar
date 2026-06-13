import { MonthCalendar } from '@/components/MonthCalendar';
import { MonthYearPicker } from '@/components/MonthYearPicker';
import { SetupChip } from '@/components/SetupChip';
import { Topbar } from '@/components/Topbar';
import { useMyDietPlan } from '@/hooks/useDietPlans';
import { useMealPlan, useMealPlanRanges } from '@/hooks/usePlannings';
import { addMonths, formatLongDate, formatMonthYear } from '@/lib/dates';
import { useActiveHousehold } from '@/stores/activeHousehold';
import type { MealPlanRange } from '@mealendar/shared';
import dayjs from 'dayjs';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Page Planning : calendrier mois custom (style FamilyWall).
 *
 * - Grille pleine hauteur, bandes nommees pour les plages.
 * - Slide gauche/droite pour changer de mois (carousel 3 mois + PanResponder).
 * - Tap nom du mois : selecteur mois/annee en pur JS (MonthYearPicker).
 * - Tap sur un jour : si dans une plage -> ouvre la plage ; sinon -> ouvre la
 *   vue range avec ce seul jour (les dates s'ajustent sur cet ecran).
 */
export default function PlanningIndexScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = 56 + Math.max(insets.bottom, 8);
  const screenW = Dimensions.get('window').width;

  const householdId = useActiveHousehold((s) => s.householdId);
  const mealPlan = useMealPlan(householdId);
  const myDietPlan = useMyDietPlan(householdId);
  const ranges = useMealPlanRanges(householdId);

  // ---------------------------------------------------------------------------
  // Modele du carousel : un mois de base STABLE + un offset entier.
  //   mois affiche = addMonths(baseMonth, offset)
  // On rend une fenetre de (2*WINDOW+1) mois autour de l'offset, tous montes
  // a l'avance (positionnes en absolu), pour eviter tout lag au slide.
  // ---------------------------------------------------------------------------
  const WINDOW = 3; // nombre de mois pre-rendus de chaque cote
  const currentMonth = dayjs().date(1).format('YYYY-MM-DD');
  const baseMonth = useRef(currentMonth).current; // jamais reconstruit
  const [offset, setOffset] = useState(0);

  const month = addMonths(baseMonth, offset);
  const isCurrentMonth = month === currentMonth;

  const [showPicker, setShowPicker] = useState(false);

  // Selection d'une plage sur la grille : 1er tap = debut, 2e tap = fin.
  // null = pas de selection en cours.
  const [selStart, setSelStart] = useState<string | null>(null);

  /** Map date -> plage existante (tap -> ouvrir la bonne vue). */
  const rangeForDate = useMemo(() => {
    const map = new Map<string, MealPlanRange>();
    for (const r of ranges.data ?? []) {
      let cur = r.dateFrom;
      while (cur <= r.dateTo) {
        if (!map.has(cur)) map.set(cur, r);
        cur = dayjs(cur).add(1, 'day').format('YYYY-MM-DD');
      }
    }
    return map;
  }, [ranges.data]);

  const openRange = (from: string, to: string) => {
    setSelStart(null);
    router.push(`/(app)/(tabs)/planning/range/${from}/${to}`);
  };

  const onDayPress = (date: string) => {
    // Mode selection en cours : ce tap fixe la fin de la plage.
    if (selStart) {
      const [from, to] = selStart <= date ? [selStart, date] : [date, selStart];
      openRange(from, to);
      return;
    }
    // Jour dans une plage existante -> ouvre cette plage directement.
    const existing = rangeForDate.get(date);
    if (existing) {
      openRange(existing.dateFrom, existing.dateTo);
      return;
    }
    // Jour hors plage -> demarre une selection (debut). Le 2e tap fixera la fin.
    setSelStart(date);
  };

  const cancelSelection = () => setSelStart(null);

  // ---------------------------------------------------------------------------
  // Slide horizontal entre mois (Animated natif, sans reanimated)
  // translateX represente le decalage du "ruban" : au repos il vaut
  // -offset * screenW (le mois courant est centre dans le viewport).
  // ---------------------------------------------------------------------------
  const translateX = useRef(new Animated.Value(0)).current;
  const isAnimating = useRef(false);
  // offset courant accessible dans les closures du PanResponder (qui est memo).
  const offsetRef = useRef(0);
  offsetRef.current = offset;

  // Recentre le ruban sur l'offset donne (instantane).
  const recenter = (o: number) => {
    translateX.setValue(-o * screenW);
  };

  const goToMonth = (newOffset: number) => {
    setOffset(newOffset);
    recenter(newOffset);
  };

  /** Revient au mois courant. */
  const goToToday = () => goToMonth(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refs stables, recree seulement sur changement de largeur
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
        onPanResponderMove: (_, g) => {
          if (isAnimating.current) return;
          translateX.setValue(-offsetRef.current * screenW + g.dx);
        },
        onPanResponderRelease: (_, g) => {
          if (isAnimating.current) return;
          const threshold = screenW * 0.25;
          const cur = offsetRef.current;
          const settle = (next: number) => {
            isAnimating.current = true;
            Animated.timing(translateX, {
              toValue: -next * screenW,
              duration: 200,
              useNativeDriver: true,
            }).start(() => {
              isAnimating.current = false;
              if (next !== cur) setOffset(next);
            });
          };
          if (g.dx > threshold) settle(cur - 1);
          else if (g.dx < -threshold) settle(cur + 1);
          else settle(cur);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [screenW],
  );

  const onPickerConfirm = (isoMonth: string) => {
    // Convertit le mois choisi en offset par rapport au baseMonth stable.
    const diff = dayjs(isoMonth).diff(dayjs(baseMonth), 'month');
    goToMonth(diff);
    setShowPicker(false);
  };

  // ---------------------------------------------------------------------------
  // Setup chip
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
    ? Object.values(myDietPlan.data.dietPlan.slots).reduce((acc, c) => acc + (c?.length ?? 0), 0)
    : 0;
  const dietRulesCount = myDietPlan.data?.dietPlan?.dailyRules?.length ?? 0;

  const allRanges = ranges.data ?? [];

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
      edges={['top']}
    >
      <Topbar />

      <View style={[styles.container, { paddingBottom: tabBarHeight }]}>
        {/* Header : nom du mois (cliquable -> picker) + bouton Aujourd'hui + SetupChip */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => setShowPicker(true)} activeOpacity={0.6}>
            <Text variant="headlineSmall" style={styles.monthTitle}>
              {formatMonthYear(month)}
            </Text>
          </TouchableOpacity>
          <View style={styles.headerActions}>
            <Button
              mode="text"
              compact
              onPress={goToToday}
              icon="calendar-today"
              disabled={isCurrentMonth}
              style={styles.todayBtn}
              labelStyle={styles.todayBtnLabel}
            >
              Aujourd'hui
            </Button>
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

        {/* Bandeau de selection : visible apres le 1er tap, en attente du 2e. */}
        {selStart && (
          <View style={[styles.selBanner, { backgroundColor: theme.colors.primaryContainer }]}>
            <Text
              style={[styles.selBannerText, { color: theme.colors.onPrimaryContainer }]}
              numberOfLines={1}
            >
              Debut : {formatLongDate(selStart)} — choisissez la fin
            </Text>
            <Button mode="text" compact onPress={cancelSelection} labelStyle={styles.selBannerBtn}>
              Annuler
            </Button>
          </View>
        )}

        {/* Ruban de mois pre-rendus (fenetre -WINDOW..+WINDOW autour de l'offset).
            Chaque mois est positionne en absolu a left = slideOffset * screenW ;
            le ruban est translate pour centrer l'offset courant. Les voisins
            sont deja montes -> aucun lag au slide. */}
        <View style={styles.carouselViewport} {...panResponder.panHandlers}>
          <Animated.View style={[styles.carousel, { transform: [{ translateX }] }]}>
            {Array.from({ length: WINDOW * 2 + 1 }, (_, i) => {
              const slideOffset = offset - WINDOW + i;
              return (
                <View
                  key={slideOffset}
                  style={[styles.slide, { left: slideOffset * screenW, width: screenW }]}
                >
                  <MonthCalendar
                    month={addMonths(baseMonth, slideOffset)}
                    ranges={allRanges}
                    width={screenW}
                    onDayPress={onDayPress}
                    selStart={selStart}
                  />
                </View>
              );
            })}
          </Animated.View>
        </View>
      </View>

      <MonthYearPicker
        visible={showPicker}
        value={month}
        onConfirm={onPickerConfirm}
        onDismiss={() => setShowPicker(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  monthTitle: { fontWeight: '800' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  todayBtn: { marginRight: -4 },
  todayBtnLabel: { fontSize: 13, marginVertical: 0 },
  selBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 12,
    marginBottom: 4,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: 12,
  },
  selBannerText: { flex: 1, fontSize: 13, fontWeight: '600' },
  selBannerBtn: { fontSize: 13, marginVertical: 4 },
  // Le viewport masque les mois hors ecran.
  carouselViewport: { flex: 1, overflow: 'hidden' },
  // Le ruban occupe tout le viewport ; les slides sont positionnes en absolu.
  carousel: { flex: 1 },
  slide: { position: 'absolute', top: 0, bottom: 0 },
});
