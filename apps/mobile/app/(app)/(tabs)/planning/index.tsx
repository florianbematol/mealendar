import { SetupChip } from '@/components/SetupChip';
import { Topbar } from '@/components/Topbar';
import { useMyDietPlan } from '@/hooks/useDietPlans';
import {
  useCreateMealPlanRange,
  useMealPlan,
  useMealPlanRanges,
  useMealsRange,
} from '@/hooks/usePlannings';
import { addMonths, monthGrid, todayIso } from '@/lib/dates';
import { useActiveHousehold } from '@/stores/activeHousehold';
import { type MealPlanRange, findCoveredSlots } from '@mealendar/shared';
import dayjs from 'dayjs';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text, TextInput, useTheme } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { type CalendarDay, useDefaultStyles } from 'react-native-ui-datepicker';

/**
 * Page Planning : calendrier mois base sur react-native-ui-datepicker.
 *
 * Interactions :
 *  - mode "range" : l'utilisateur tape une 1ere date puis une 2e -> on
 *    propose de creer une plage de menus (modale de nom) puis on navigue
 *    vers la vue d'edition multi-jours.
 *  - tap sur un seul jour (sans 2e tap) : on attend le 2e tap. Pour ouvrir
 *    un jour isole, on tape 2 fois la meme date (range d'1 jour) -> vue jour.
 *  - jours planifies (au moins 1 repas) : marques d'un dot.
 *  - jours appartenant a une plage existante : fond colore + tap ouvre la
 *    vue range correspondante.
 *
 * Plus de carousel custom / reanimated : la lib gere le swipe entre mois.
 */

export default function PlanningIndexScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = 56 + Math.max(insets.bottom, 8);
  const defaultStyles = useDefaultStyles();

  const householdId = useActiveHousehold((s) => s.householdId);
  const mealPlan = useMealPlan(householdId);
  const myDietPlan = useMyDietPlan(householdId);

  // Mois actuellement affiche (1er jour du mois). On fetch une fenetre large
  // autour (mois precedent -> mois suivant) pour avoir les dots prets quand
  // on navigue.
  const [visibleMonth, setVisibleMonth] = useState<string>(() => todayIso());

  const fetchWindow = useMemo(() => {
    const prevCells = monthGrid(addMonths(visibleMonth, -1));
    const nextCells = monthGrid(addMonths(visibleMonth, 1));
    return {
      from: prevCells[0] as string,
      to: nextCells[nextCells.length - 1] as string,
    };
  }, [visibleMonth]);

  const meals = useMealsRange(householdId, fetchWindow.from, fetchWindow.to);
  const ranges = useMealPlanRanges(householdId, fetchWindow.from, fetchWindow.to);
  const createRange = useCreateMealPlanRange();

  // ---------------------------------------------------------------------------
  // Set des jours planifies (repas direct + jours couverts par coversMeals)
  // ---------------------------------------------------------------------------
  const plannedDays = useMemo(() => {
    const set = new Set<string>();
    const mealsList = meals.data?.meals ?? [];
    for (const m of mealsList) set.add(m.date);
    if (mealPlan.data) {
      for (const m of mealsList) {
        const cm = m.coversMeals ?? 1;
        if (cm <= 1) continue;
        const covered = findCoveredSlots({
          sourceDate: m.date,
          sourceSlotKey: m.slotKey,
          coversMeals: cm,
          slotConfig: mealPlan.data.slotConfig,
        });
        for (const c of covered) set.add(c.date);
      }
    }
    return set;
  }, [meals.data, mealPlan.data]);

  /** Map date -> plage existante (pour colorer + ouvrir la bonne vue). */
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

  // ---------------------------------------------------------------------------
  // Selection range
  // ---------------------------------------------------------------------------
  const [rangeStart, setRangeStart] = useState<string | undefined>(undefined);
  const [rangeEnd, setRangeEnd] = useState<string | undefined>(undefined);

  /** Modale de naming a la creation d'une plage. */
  const [pendingRange, setPendingRange] = useState<{ from: string; to: string } | null>(null);
  const [pendingName, setPendingName] = useState('');

  const onRangeChange = (params: { startDate?: unknown; endDate?: unknown }) => {
    const start = params.startDate
      ? dayjs(params.startDate as string).format('YYYY-MM-DD')
      : undefined;
    const end = params.endDate ? dayjs(params.endDate as string).format('YYYY-MM-DD') : undefined;
    setRangeStart(start);
    setRangeEnd(end);

    // Si on a un range complet (start + end)
    if (start && end) {
      // Cas 1 : tap sur un jour qui appartient a une plage existante (et
      // start == end == ce jour) -> ouvre la vue range de cette plage.
      if (start === end) {
        const existing = rangeForDate.get(start);
        if (existing) {
          resetRange();
          router.push(`/(app)/(tabs)/planning/range/${existing.dateFrom}/${existing.dateTo}`);
          return;
        }
        // jour isole sans plage -> vue jour
        resetRange();
        router.push(`/(app)/(tabs)/planning/day/${start}`);
        return;
      }
      // Cas 2 : vrai range (2 dates differentes) -> modale de naming
      setPendingRange({ from: start, to: end });
      setPendingName(`Plage du ${dayjs(start).format('DD/MM')}`);
    }
  };

  const resetRange = () => {
    setRangeStart(undefined);
    setRangeEnd(undefined);
  };

  const onConfirmRange = async () => {
    if (!pendingRange || !householdId) return;
    const { from, to } = pendingRange;
    const name = pendingName.trim() || `Plage du ${dayjs(from).format('DD/MM')}`;
    setPendingRange(null);
    setPendingName('');
    resetRange();
    try {
      await createRange.mutateAsync({ householdId, name, dateFrom: from, dateTo: to });
    } catch (e) {
      console.warn('[planning] create range failed', e);
    }
    router.push(`/(app)/(tabs)/planning/range/${from}/${to}`);
  };

  const onCancelRange = () => {
    setPendingRange(null);
    setPendingName('');
    resetRange();
  };

  // ---------------------------------------------------------------------------
  // Setup chip state
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

  // ---------------------------------------------------------------------------
  // Rendu custom d'un jour : dot planifie + fond plage existante
  // ---------------------------------------------------------------------------
  const renderDay = (day: CalendarDay) => {
    const dateStr = dayjs(day.date).format('YYYY-MM-DD');
    const isPlanned = plannedDays.has(dateStr);
    const inExistingRange = rangeForDate.has(dateStr);
    const isToday = day.isToday;
    return (
      <View style={styles.dayCell}>
        <Text
          style={[
            styles.dayText,
            {
              color: day.isCurrentMonth ? theme.colors.onSurface : theme.colors.onSurfaceVariant,
              fontWeight: isToday ? '800' : '500',
              opacity: day.isCurrentMonth ? 1 : 0.4,
            },
            isToday && { color: theme.colors.primary },
          ]}
        >
          {day.text}
        </Text>
        <View style={styles.dayMarkers}>
          {inExistingRange && (
            <View style={[styles.rangeBar, { backgroundColor: theme.colors.tertiary }]} />
          )}
          {isPlanned && <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} />}
        </View>
      </View>
    );
  };

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

        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4 }}>
          Tapez 2 fois un jour pour le planifier, ou selectionnez une plage de dates.
        </Text>

        <DateTimePicker
          mode="range"
          startDate={rangeStart}
          endDate={rangeEnd}
          onChange={onRangeChange}
          locale="fr"
          firstDayOfWeek={1}
          showOutsideDays
          allowRangeReset
          monthCaptionFormat="full"
          onMonthChange={(m) => {
            // m = index du mois (0-11) ; on reconstruit une date du 1er du mois
            setVisibleMonth((cur) => {
              const d = dayjs(cur).month(m).date(1);
              return d.format('YYYY-MM-DD');
            });
          }}
          onYearChange={(y) => {
            setVisibleMonth((cur) => dayjs(cur).year(y).date(1).format('YYYY-MM-DD'));
          }}
          styles={{
            ...defaultStyles,
            today: { borderColor: theme.colors.primary, borderWidth: 1 },
            selected: { backgroundColor: theme.colors.tertiaryContainer },
            selected_label: { color: theme.colors.onTertiaryContainer },
            range_fill: { backgroundColor: theme.colors.tertiaryContainer },
          }}
          components={{ Day: renderDay }}
        />
      </View>

      {/* Modale de naming a la creation d'une plage */}
      <Portal>
        <Dialog visible={!!pendingRange} onDismiss={onCancelRange}>
          <Dialog.Title>Nommer la plage</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ marginBottom: 12 }}>
              {pendingRange
                ? `${dayjs(pendingRange.from).format('DD/MM')} → ${dayjs(pendingRange.to).format('DD/MM')}`
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

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 4, gap: 4 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: { fontWeight: '700' },

  // Custom day cell
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dayText: { fontSize: 15 },
  dayMarkers: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 6,
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  rangeBar: { width: 12, height: 3, borderRadius: 2 },
});
