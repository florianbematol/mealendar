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
import { CalendarList, type DateData, LocaleConfig } from 'react-native-calendars';
import type { MarkedDates } from 'react-native-calendars/src/types';
import { Button, Dialog, Portal, Text, TextInput, useTheme } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// ============================================================================
// Locale FR pour react-native-calendars (a faire une seule fois au module)
// ============================================================================
LocaleConfig.locales.fr = {
  monthNames: [
    'Janvier',
    'Fevrier',
    'Mars',
    'Avril',
    'Mai',
    'Juin',
    'Juillet',
    'Aout',
    'Septembre',
    'Octobre',
    'Novembre',
    'Decembre',
  ],
  monthNamesShort: [
    'Janv.',
    'Fevr.',
    'Mars',
    'Avr.',
    'Mai',
    'Juin',
    'Juil.',
    'Aout',
    'Sept.',
    'Oct.',
    'Nov.',
    'Dec.',
  ],
  dayNames: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
  dayNamesShort: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'],
  today: "Aujourd'hui",
};
LocaleConfig.defaultLocale = 'fr';

/**
 * Page Planning : calendrier mois base sur react-native-calendars.
 *
 * Marking :
 *  - markingType "period" : les plages existantes apparaissent comme des
 *    barres continues colorees (sans label).
 *  - dot : les jours planifies (au moins un repas) ont un point.
 *  - la selection de range en cours est aussi affichee en period (couleur
 *    differente).
 *
 * Interactions :
 *  - 1er tap : pose le debut du range. 2e tap : si meme jour -> ouvre la
 *    vue jour (ou la vue range si jour dans une plage existante) ; sinon
 *    -> modale de naming -> creation plage + vue range.
 *
 * NOTE UI : le style est laisse au theme par defaut de react-native-calendars.
 * La customization (couleurs, police, hauteur des cellules) se fera via la
 * prop `theme` du <Calendar> et les `selectedColor`/`color` des markedDates.
 */
export default function PlanningIndexScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = 56 + Math.max(insets.bottom, 8);

  const householdId = useActiveHousehold((s) => s.householdId);
  const mealPlan = useMealPlan(householdId);
  const myDietPlan = useMyDietPlan(householdId);

  // Mois visible (string YYYY-MM-DD du 1er jour). On fetch [mois-1, mois+1].
  const [visibleMonth, setVisibleMonth] = useState<string>(() => todayIso());

  const fetchWindow = useMemo(() => {
    // Fenetre large autour du mois visible : le scroll vertical affiche
    // plusieurs mois a la fois, on couvre [-2, +2] pour avoir les markings
    // prets sans refetch a chaque petit scroll.
    const prevCells = monthGrid(addMonths(visibleMonth, -2));
    const nextCells = monthGrid(addMonths(visibleMonth, 2));
    return {
      from: prevCells[0] as string,
      to: nextCells[nextCells.length - 1] as string,
    };
  }, [visibleMonth]);

  const meals = useMealsRange(householdId, fetchWindow.from, fetchWindow.to);
  const ranges = useMealPlanRanges(householdId, fetchWindow.from, fetchWindow.to);
  const createRange = useCreateMealPlanRange();

  // ---------------------------------------------------------------------------
  // Jours planifies (repas direct + couverts par coversMeals)
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

  /** Map date -> plage existante (pour ouvrir la bonne vue au tap). */
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
  // Selection de range maison (react-native-calendars n'a pas de mode range
  // natif : on gere start/end nous-memes via onDayPress)
  // ---------------------------------------------------------------------------
  const [rangeStart, setRangeStart] = useState<string | null>(null);

  const [pendingRange, setPendingRange] = useState<{ from: string; to: string } | null>(null);
  const [pendingName, setPendingName] = useState('');

  const onDayPress = (day: DateData) => {
    const date = day.dateString; // YYYY-MM-DD

    if (!rangeStart) {
      // 1er tap : on pose le debut de la selection.
      setRangeStart(date);
      return;
    }

    // 2e tap
    if (date === rangeStart) {
      // Tap 2x le meme jour : ouvre la vue jour (ou la plage existante).
      setRangeStart(null);
      const existing = rangeForDate.get(date);
      if (existing) {
        router.push(`/(app)/(tabs)/planning/range/${existing.dateFrom}/${existing.dateTo}`);
      } else {
        router.push(`/(app)/(tabs)/planning/day/${date}`);
      }
      return;
    }

    // Range complet : on ordonne et on propose de creer une plage.
    const from = date < rangeStart ? date : rangeStart;
    const to = date < rangeStart ? rangeStart : date;
    setRangeStart(null);
    setPendingRange({ from, to });
    setPendingName(`Plage du ${dayjs(from).format('DD/MM')}`);
  };

  const onConfirmRange = async () => {
    if (!pendingRange || !householdId) return;
    const { from, to } = pendingRange;
    const name = pendingName.trim() || `Plage du ${dayjs(from).format('DD/MM')}`;
    setPendingRange(null);
    setPendingName('');
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
  };

  // ---------------------------------------------------------------------------
  // Construction des markedDates pour react-native-calendars
  //
  // markingType="period" : pour chaque plage existante, on marque
  // startingDay / endingDay / jours du milieu avec une couleur. Les jours
  // planifies recoivent un dot (marked + dotColor). La selection en cours
  // (rangeStart) recoit un selected.
  // ---------------------------------------------------------------------------
  const markedDates = useMemo<MarkedDates>(() => {
    const marks: MarkedDates = {};

    // 1. Plages existantes -> period
    for (const r of ranges.data ?? []) {
      let cur = r.dateFrom;
      while (cur <= r.dateTo) {
        const isStart = cur === r.dateFrom;
        const isEnd = cur === r.dateTo;
        marks[cur] = {
          ...marks[cur],
          // NOTE UI : couleur de la barre de periode (theme.colors.tertiaryContainer)
          color: theme.colors.tertiaryContainer,
          textColor: theme.colors.onTertiaryContainer,
          startingDay: isStart,
          endingDay: isEnd,
        };
        cur = dayjs(cur).add(1, 'day').format('YYYY-MM-DD');
      }
    }

    // 2. Jours planifies -> dot
    for (const d of plannedDays) {
      marks[d] = {
        ...marks[d],
        marked: true,
        // NOTE UI : couleur du dot (theme.colors.primary)
        dotColor: theme.colors.primary,
      };
    }

    // 3. Selection en cours -> selected
    if (rangeStart) {
      marks[rangeStart] = {
        ...marks[rangeStart],
        selected: true,
        // NOTE UI : couleur de la cellule selectionnee
        selectedColor: theme.colors.primary,
      };
    }

    return marks;
  }, [ranges.data, plannedDays, rangeStart, theme.colors]);

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

        {/* NOTE UI : le style global se customise via la prop `theme`.
            CalendarList = scroll vertical infini (plusieurs mois empiles). */}
        <CalendarList
          markingType="period"
          markedDates={markedDates}
          onDayPress={onDayPress}
          firstDay={1}
          // Scroll vertical (defaut). Nombre de mois rendus avant/apres le
          // mois courant ; au-dela le scroll s'arrete (semi-infini).
          pastScrollRange={24}
          futureScrollRange={24}
          showScrollIndicator={false}
          // Quand les mois visibles changent, on recentre la fenetre de fetch
          // sur le 1er mois visible.
          onVisibleMonthsChange={(months: DateData[]) => {
            const first = months[0];
            if (first) {
              setVisibleMonth(dayjs(first.dateString).date(1).format('YYYY-MM-DD'));
            }
          }}
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
});
