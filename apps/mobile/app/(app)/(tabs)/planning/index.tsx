import { SetupChip } from '@/components/SetupChip';
import { Topbar } from '@/components/Topbar';
import { useMyDietPlan } from '@/hooks/useDietPlans';
import { useCreateMealPlanRange, useMealPlan, useMealPlanRanges } from '@/hooks/usePlannings';
import { useActiveHousehold } from '@/stores/activeHousehold';
import type { MealPlanRange } from '@mealendar/shared';
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
 * Page Planning : calendrier scroll vertical (CalendarList).
 *
 * Le calendrier n'affiche QUE les plages de menus (meal_plan_ranges) sous
 * forme de barres de periode continues. Les repas individuels (planned_meals)
 * ne sont PAS affiches ici : le detail des repas se consulte en ouvrant un
 * jour ou une plage.
 *
 * On charge TOUTES les plages du foyer (peu nombreuses, legeres) en une
 * requete, sans filtre de date -> le scroll est instantane, les barres
 * toujours presentes.
 *
 * Interactions :
 *  - 1er tap : pose le debut de la selection.
 *  - 2e tap sur un autre jour : modale de naming -> creation plage + vue range.
 *  - 2e tap sur le meme jour : ouvre la vue jour (ou la vue range si le jour
 *    appartient deja a une plage existante).
 *
 * NOTE UI : style laisse au theme par defaut de react-native-calendars.
 */
export default function PlanningIndexScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = 56 + Math.max(insets.bottom, 8);

  const householdId = useActiveHousehold((s) => s.householdId);
  const mealPlan = useMealPlan(householdId);
  const myDietPlan = useMyDietPlan(householdId);

  // Toutes les plages du foyer (sans filtre date).
  const ranges = useMealPlanRanges(householdId);
  const createRange = useCreateMealPlanRange();

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
      setRangeStart(date);
      return;
    }

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
  // markedDates : uniquement les plages (period) + la selection en cours.
  // ---------------------------------------------------------------------------
  const markedDates = useMemo<MarkedDates>(() => {
    const marks: MarkedDates = {};

    for (const r of ranges.data ?? []) {
      let cur = r.dateFrom;
      while (cur <= r.dateTo) {
        marks[cur] = {
          ...marks[cur],
          // NOTE UI : couleur de la barre de periode
          color: theme.colors.tertiaryContainer,
          textColor: theme.colors.onTertiaryContainer,
          startingDay: cur === r.dateFrom,
          endingDay: cur === r.dateTo,
        };
        cur = dayjs(cur).add(1, 'day').format('YYYY-MM-DD');
      }
    }

    if (rangeStart) {
      marks[rangeStart] = {
        ...marks[rangeStart],
        selected: true,
        // NOTE UI : couleur de la cellule selectionnee (1er tap)
        selectedColor: theme.colors.primary,
      };
    }

    return marks;
  }, [ranges.data, rangeStart, theme.colors]);

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
          Selectionnez une plage de dates pour planifier vos repas.
        </Text>

        {/* NOTE UI : style global via la prop `theme`. CalendarList = scroll
            vertical infini. Affiche uniquement les plages (period marking). */}
        <CalendarList
          markingType="period"
          markedDates={markedDates}
          onDayPress={onDayPress}
          firstDay={1}
          pastScrollRange={24}
          futureScrollRange={24}
          showScrollIndicator={false}
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
