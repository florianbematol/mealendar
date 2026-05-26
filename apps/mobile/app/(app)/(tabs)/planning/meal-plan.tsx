import { useMealPlan, useUpsertMealPlan } from '@/hooks/usePlannings';
import { ApiError } from '@/lib/api';
import { WEEKDAYS, WEEKDAY_LABELS, type Weekday } from '@/lib/dates';
import { useActiveHousehold } from '@/stores/activeHousehold';
import type { PlanSlot, SlotConfig } from '@mealendar/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  HelperText,
  IconButton,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

const DEFAULT_SLOTS: PlanSlot[] = [
  { key: 'breakfast', time: '08:00' },
  { key: 'lunch', time: '12:30' },
  { key: 'snack', time: '16:30' },
  { key: 'dinner', time: '19:30' },
];

const SLOT_LABELS: Record<string, string> = {
  breakfast: 'Petit-dej',
  lunch: 'Dejeuner',
  snack: 'Gouter',
  dinner: 'Diner',
};

const DEFAULT_CONFIG: SlotConfig = WEEKDAYS.reduce((acc, day) => {
  acc[day] = [
    { key: 'lunch', time: '12:30' },
    { key: 'dinner', time: '19:30' },
  ];
  return acc;
}, {} as SlotConfig);

export default function MealPlanScreen() {
  const theme = useTheme();
  const householdId = useActiveHousehold((s) => s.householdId);
  const mealPlan = useMealPlan(householdId);
  const upsert = useUpsertMealPlan();

  const [name, setName] = useState('Semaine type');
  const [config, setConfig] = useState<SlotConfig>(DEFAULT_CONFIG);
  const [error, setError] = useState<string | null>(null);

  // Initialise depuis le plan existant
  useEffect(() => {
    if (!mealPlan.data) return;
    setName(mealPlan.data.name);
    setConfig(mealPlan.data.slotConfig);
  }, [mealPlan.data]);

  const toggleSlot = (day: Weekday, slotKey: string) => {
    setConfig((cur) => {
      const slots = cur[day] ?? [];
      const exists = slots.find((s) => s.key === slotKey);
      const newSlots = exists
        ? slots.filter((s) => s.key !== slotKey)
        : [...slots, DEFAULT_SLOTS.find((s) => s.key === slotKey) ?? { key: slotKey }];
      return { ...cur, [day]: newSlots };
    });
  };

  const applyToAll = (templateDay: Weekday) => {
    const tpl = config[templateDay] ?? [];
    setConfig(() => {
      const acc = { ...config };
      for (const d of WEEKDAYS) acc[d] = [...tpl];
      return acc;
    });
  };

  const onSave = async () => {
    if (!householdId) return;
    setError(null);
    try {
      await upsert.mutateAsync({
        householdId,
        mealPlanId: mealPlan.data?.id ?? null,
        name: name.trim() || 'Semaine type',
        slotConfig: config,
      });
      router.back();
    } catch (e) {
      if (e instanceof ApiError) setError(`${e.status} - ${e.message}`);
      else setError(e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  const totalSlots = useMemo(
    () => WEEKDAYS.reduce((acc, d) => acc + (config[d]?.length ?? 0), 0),
    [config],
  );

  if (mealPlan.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={[]}>
      <ScrollView contentContainerStyle={styles.container}>
        <Surface elevation={0} style={[styles.intro, { backgroundColor: theme.colors.surface }]}>
          <Text variant="bodyMedium">
            Pour chaque jour, choisissez quels repas vous voulez planifier. Cela definit le
            squelette utilise pour la generation automatique.
          </Text>
          <Text
            variant="labelMedium"
            style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}
          >
            {totalSlots} repas par semaine
          </Text>
        </Surface>

        {WEEKDAYS.map((day) => {
          const slots = config[day] ?? [];
          return (
            <Surface
              key={day}
              elevation={0}
              style={[styles.dayCard, { backgroundColor: theme.colors.surface }]}
            >
              <View style={styles.dayHeader}>
                <Text variant="titleMedium" style={styles.dayName}>
                  {WEEKDAY_LABELS[day]}
                </Text>
                <IconButton
                  icon="content-copy"
                  size={18}
                  onPress={() => applyToAll(day)}
                  iconColor={theme.colors.onSurfaceVariant}
                />
              </View>
              <View style={styles.slotsRow}>
                {DEFAULT_SLOTS.map((s) => {
                  const active = slots.some((x) => x.key === s.key);
                  return (
                    <Chip
                      key={s.key}
                      compact
                      selected={active}
                      onPress={() => toggleSlot(day, s.key)}
                      icon={active ? 'check' : undefined}
                      style={{
                        backgroundColor: active
                          ? theme.colors.primaryContainer
                          : theme.colors.surfaceVariant,
                      }}
                      textStyle={{
                        color: active
                          ? theme.colors.onPrimaryContainer
                          : theme.colors.onSurfaceVariant,
                        fontWeight: active ? '700' : '500',
                      }}
                    >
                      {SLOT_LABELS[s.key] ?? s.key}
                    </Chip>
                  );
                })}
              </View>
            </Surface>
          );
        })}

        {error && (
          <HelperText type="error" visible>
            {error}
          </HelperText>
        )}

        <View style={styles.actions}>
          <Button mode="outlined" onPress={() => router.back()} disabled={upsert.isPending}>
            Annuler
          </Button>
          <Button
            mode="contained"
            onPress={onSave}
            loading={upsert.isPending}
            disabled={upsert.isPending}
            icon="check"
            style={styles.saveBtn}
          >
            Enregistrer
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: {
    padding: 16,
    gap: 10,
    paddingBottom: 32,
  },
  intro: {
    padding: 14,
    borderRadius: 12,
    marginBottom: 4,
  },
  dayCard: {
    padding: 12,
    borderRadius: 14,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayName: { fontWeight: '700' },
  slotsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  saveBtn: { borderRadius: 12 },
});
