/**
 * Mini checklist d'onboarding affichee sur l'accueil quand le user n'a
 * pas encore configure tous les elements essentiels :
 *  1. plan-type configure (au moins 1 slot par jour)
 *  2. plan alimentaire personnel configure
 *  3. au moins 1 recette dans la bibliotheque
 *  4. au moins 1 repas planifie cette semaine
 *
 * Quand toutes les etapes sont validees, le composant ne rend rien
 * (il disparait completement, sans tracer "100%").
 */
import { useMyDietPlan } from '@/hooks/useDietPlans';
import { useMealPlan, useMealsRange } from '@/hooks/usePlannings';
import { useRecipes } from '@/hooks/useRecipes';
import { addDays, startOfWeek, todayIso } from '@/lib/dates';
import { useActiveHousehold } from '@/stores/activeHousehold';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ProgressBar, Surface, Text, TouchableRipple, useTheme } from 'react-native-paper';

type Step = {
  key: string;
  label: string;
  description: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  done: boolean;
  onPress: () => void;
};

export function OnboardingChecklist() {
  const theme = useTheme();
  const householdId = useActiveHousehold((s) => s.householdId);

  const mealPlan = useMealPlan(householdId);
  const myDietPlan = useMyDietPlan(householdId);
  const recipes = useRecipes(householdId);
  const weekRange = useMemo(() => {
    const start = startOfWeek(todayIso());
    return { from: start, to: addDays(start, 6) };
  }, []);
  const meals = useMealsRange(householdId, weekRange.from, weekRange.to);

  const isLoading =
    mealPlan.isPending || myDietPlan.isPending || recipes.isPending || meals.isPending;
  if (isLoading) return null;

  const slotConfigured =
    !!mealPlan.data?.slotConfig &&
    Object.values(mealPlan.data.slotConfig).some((slots) => (slots ?? []).length > 0);
  const dietConfigured =
    !!myDietPlan.data &&
    (myDietPlan.data.regimes.length > 0 ||
      myDietPlan.data.allergies.length > 0 ||
      myDietPlan.data.goals.length > 0 ||
      Object.values(myDietPlan.data.dietPlan.slots).some((s) => (s ?? []).length > 0));
  const hasRecipes = (recipes.data?.items.length ?? 0) > 0;
  const hasMealsThisWeek = (meals.data?.meals.length ?? 0) > 0;

  const steps: Step[] = [
    {
      key: 'meal-plan',
      label: 'Configurer mon plan-type',
      description: 'Definissez les repas de la semaine (petit-dej, dejeuner, diner...).',
      icon: 'calendar-clock',
      done: slotConfigured,
      onPress: () => router.push('/(app)/(tabs)/planning/meal-plan'),
    },
    {
      key: 'diet-plan',
      label: 'Mon plan alimentaire',
      description: 'Regimes, allergies, composants par repas.',
      icon: 'food-apple-outline',
      done: dietConfigured,
      onPress: () => router.push('/(app)/(tabs)/planning/diet-plan'),
    },
    {
      key: 'recipes',
      label: 'Ajouter ma premiere recette',
      description: "Creez-en une, ou laissez l'IA en proposer.",
      icon: 'silverware-fork-knife',
      done: hasRecipes,
      onPress: () => router.push('/(app)/(tabs)/recipes'),
    },
    {
      key: 'planning',
      label: 'Planifier cette semaine',
      description: 'Posez votre premier repas sur le calendrier.',
      icon: 'calendar-blank',
      done: hasMealsThisWeek,
      onPress: () => router.push('/(app)/(tabs)/planning'),
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null; // Tout est fait, on cache la checklist

  const progress = doneCount / steps.length;

  return (
    <Surface elevation={0} style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.header}>
        <Text variant="titleSmall" style={styles.title}>
          🚀 Pour bien commencer
        </Text>
        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {doneCount} / {steps.length}
        </Text>
      </View>
      <ProgressBar progress={progress} color={theme.colors.primary} style={styles.progress} />
      <View style={styles.stepsList}>
        {steps.map((step) => (
          <TouchableRipple key={step.key} onPress={step.onPress} borderless style={styles.stepRow}>
            <View style={styles.stepInner}>
              <View
                style={[
                  styles.iconBubble,
                  {
                    backgroundColor: step.done ? theme.colors.primary : theme.colors.surfaceVariant,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={step.done ? 'check' : step.icon}
                  size={18}
                  color={step.done ? theme.colors.onPrimary : theme.colors.onSurfaceVariant}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  variant="titleSmall"
                  style={[
                    styles.stepLabel,
                    {
                      color: step.done ? theme.colors.onSurfaceVariant : theme.colors.onSurface,
                      textDecorationLine: step.done ? 'line-through' : 'none',
                    },
                  ]}
                >
                  {step.label}
                </Text>
                {!step.done && (
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
                  >
                    {step.description}
                  </Text>
                )}
              </View>
              {!step.done && (
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={22}
                  color={theme.colors.onSurfaceVariant}
                />
              )}
            </View>
          </TouchableRipple>
        ))}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontWeight: '700' },
  progress: { height: 6, borderRadius: 3 },
  stepsList: { gap: 4 },
  stepRow: {
    borderRadius: 10,
    padding: 10,
  },
  stepInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepLabel: { fontWeight: '600' },
});
