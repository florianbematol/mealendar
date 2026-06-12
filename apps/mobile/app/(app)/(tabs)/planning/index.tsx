import { MonthCalendar } from '@/components/MonthCalendar';
import { SetupChip } from '@/components/SetupChip';
import { Topbar } from '@/components/Topbar';
import { useMyDietPlan } from '@/hooks/useDietPlans';
import { useMealPlan, useMealPlanRanges } from '@/hooks/usePlannings';
import { addMonths, formatMonthYear, todayIso } from '@/lib/dates';
import { useActiveHousehold } from '@/stores/activeHousehold';
import type { MealPlanRange } from '@mealendar/shared';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import dayjs from 'dayjs';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  Platform,
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
 * - Tap nom du mois : date-picker natif pour sauter mois/annee.
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

  // Mois affiche (string YYYY-MM-DD, 1er du mois).
  const [month, setMonth] = useState<string>(() => dayjs().date(1).format('YYYY-MM-DD'));
  const [showPicker, setShowPicker] = useState(false);

  const currentMonth = dayjs().date(1).format('YYYY-MM-DD');
  const isCurrentMonth = month === currentMonth;

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

  const onDayPress = (date: string) => {
    const existing = rangeForDate.get(date);
    if (existing) {
      router.push(`/(app)/(tabs)/planning/range/${existing.dateFrom}/${existing.dateTo}`);
    } else {
      // Jour hors plage : on ouvre la vue range avec ce seul jour (from=to).
      // Les dates s'ajustent ensuite sur cet ecran.
      router.push(`/(app)/(tabs)/planning/range/${date}/${date}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Slide horizontal entre mois (Animated natif, sans reanimated)
  // Carousel 3 mois : [prev, current, next]. translateX initial = -screenW.
  // ---------------------------------------------------------------------------
  const translateX = useRef(new Animated.Value(-screenW)).current;
  const isAnimating = useRef(false);

  const commit = (direction: -1 | 1) => {
    setMonth((m) => addMonths(m, direction));
    // Apres le commit, on re-centre instantanement (le nouveau mois courant
    // est deja affiche au centre du carousel reconstruit).
    translateX.setValue(-screenW);
    isAnimating.current = false;
  };

  /** Revient au mois courant (sans animation de slide). */
  const goToToday = () => {
    setMonth(currentMonth);
    translateX.setValue(-screenW);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: commit/translateX stables, on ne recree le responder que sur changement de largeur
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
        onPanResponderMove: (_, g) => {
          if (isAnimating.current) return;
          translateX.setValue(-screenW + g.dx);
        },
        onPanResponderRelease: (_, g) => {
          if (isAnimating.current) return;
          const threshold = screenW * 0.25;
          if (g.dx > threshold) {
            isAnimating.current = true;
            Animated.timing(translateX, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true,
            }).start(() => commit(-1));
          } else if (g.dx < -threshold) {
            isAnimating.current = true;
            Animated.timing(translateX, {
              toValue: -screenW * 2,
              duration: 200,
              useNativeDriver: true,
            }).start(() => commit(1));
          } else {
            Animated.spring(translateX, {
              toValue: -screenW,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [screenW],
  );

  const onPickerChange = (event: DateTimePickerEvent, date?: Date) => {
    // Android : l'event 'dismissed' ferme sans changer. 'set' applique.
    if (Platform.OS === 'android') setShowPicker(false);
    if (event.type === 'set' && date) {
      setMonth(dayjs(date).date(1).format('YYYY-MM-DD'));
      translateX.setValue(-screenW);
      if (Platform.OS === 'ios') setShowPicker(false);
    }
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
            {!isCurrentMonth && (
              <Button
                mode="text"
                compact
                onPress={goToToday}
                icon="calendar-today"
                style={styles.todayBtn}
                labelStyle={styles.todayBtnLabel}
              >
                Aujourd'hui
              </Button>
            )}
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

        {/* Carousel 3 mois (prev / current / next) qui slide horizontalement */}
        <View style={styles.carouselViewport} {...panResponder.panHandlers}>
          <Animated.View
            style={[styles.carousel, { width: screenW * 3, transform: [{ translateX }] }]}
          >
            <MonthCalendar
              month={addMonths(month, -1)}
              ranges={allRanges}
              width={screenW}
              onDayPress={onDayPress}
            />
            <MonthCalendar
              month={month}
              ranges={allRanges}
              width={screenW}
              onDayPress={onDayPress}
            />
            <MonthCalendar
              month={addMonths(month, 1)}
              ranges={allRanges}
              width={screenW}
              onDayPress={onDayPress}
            />
          </Animated.View>
        </View>
      </View>

      {showPicker && (
        <DateTimePicker
          value={dayjs(month).toDate()}
          mode="date"
          display="default"
          onChange={onPickerChange}
        />
      )}
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
  // Le viewport masque les mois prev/next hors ecran.
  carouselViewport: { flex: 1, overflow: 'hidden' },
  carousel: { flex: 1, flexDirection: 'row' },
});
