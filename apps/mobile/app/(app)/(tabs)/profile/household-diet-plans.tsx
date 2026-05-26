/**
 * Page lecture seule : tous les profils dietetiques des membres du foyer.
 *
 * Affiche pour chaque membre :
 *  - email
 *  - regimes (chips)
 *  - allergies (chips)
 *  - objectifs (chips)
 *  - resume des composants par slot
 *
 * L'utilisateur ne peut editer que SON propre profil (cf. /planning/diet-plan).
 */
import { useHouseholdDietPlans } from '@/hooks/useDietPlans';
import { useActiveHousehold } from '@/stores/activeHousehold';
import type { DietCategory, DietComponent, UserDietPlan } from '@mealendar/shared';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  type MD3Theme,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

const SLOT_LABELS: Record<string, string> = {
  breakfast: 'Petit-dej',
  lunch: 'Dejeuner',
  snack: 'Gouter',
  dinner: 'Diner',
};

const REGIME_LABELS: Record<string, string> = {
  vegetarian: 'Vegetarien',
  vegan: 'Vegan',
  pescatarian: 'Pesco',
  gluten_free: 'Sans gluten',
  lactose_free: 'Sans lactose',
  halal: 'Halal',
  kosher: 'Casher',
  low_carb: 'Low carb',
  high_protein: 'Hyperproteine',
};

const GOAL_LABELS: Record<string, string> = {
  weight_loss: 'Perte de poids',
  weight_gain: 'Prise de poids',
  muscle_gain: 'Prise de masse',
  maintenance: 'Maintien',
  health_improvement: 'Sante',
};

const CATEGORY_EMOJI: Record<DietCategory, string> = {
  legumes: '🥦',
  fruit: '🍎',
  viande: '🥩',
  poisson: '🐟',
  oeuf: '🥚',
  legumineuse: '🫘',
  feculent: '🍚',
  pain: '🍞',
  produit_laitier: '🥛',
  fromage: '🧀',
  fruits_a_coque: '🥜',
  matiere_grasse: '🫒',
  sucre: '🍯',
  autre: '🍽️',
};

function emojiFor(comp: DietComponent): string {
  const first = comp.alternatives[0];
  if (!first) return '🍽️';
  return CATEGORY_EMOJI[first.category] ?? '🍽️';
}

export default function HouseholdDietPlansScreen() {
  const theme = useTheme();
  const householdId = useActiveHousehold((s) => s.householdId);
  const dietPlans = useHouseholdDietPlans(householdId);

  if (dietPlans.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const items = dietPlans.data?.items ?? [];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={[]}>
      <ScrollView contentContainerStyle={styles.container}>
        {items.length === 0 ? (
          <Surface elevation={0} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            <Text variant="titleMedium" style={styles.cardTitle}>
              Aucun profil configure
            </Text>
            <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
              Vous etes peut-etre seul(e) dans ce foyer ou personne n'a encore configure son profil
              dietetique. Configurez le votre depuis Planning &gt; Plan alimentaire.
            </Text>
            <Button
              mode="contained-tonal"
              icon="account-edit-outline"
              onPress={() => router.push('/(app)/(tabs)/planning/diet-plan')}
              style={{ marginTop: 12, borderRadius: 10 }}
              compact
            >
              Configurer mon profil
            </Button>
          </Surface>
        ) : (
          items.map((p) => <MemberCard key={p.id} plan={p} theme={theme} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MemberCard({
  plan,
  theme,
}: {
  plan: UserDietPlan;
  theme: MD3Theme;
}) {
  const slots = Object.entries(plan.dietPlan.slots ?? {}).filter(
    ([_, comps]) => comps && comps.length > 0,
  );
  return (
    <Surface elevation={0} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
      <Text variant="titleMedium" style={styles.cardTitle}>
        {plan.userEmail ?? 'Membre'}
      </Text>

      {plan.regimes.length > 0 && (
        <View style={styles.section}>
          <Text variant="labelSmall" style={styles.sectionLabel}>
            Regimes
          </Text>
          <View style={styles.chipsRow}>
            {plan.regimes.map((r) => (
              <Chip
                key={r}
                compact
                style={{ backgroundColor: theme.colors.primaryContainer }}
                textStyle={{ color: theme.colors.onPrimaryContainer }}
              >
                {REGIME_LABELS[r] ?? r}
              </Chip>
            ))}
          </View>
        </View>
      )}

      {plan.allergies.length > 0 && (
        <View style={styles.section}>
          <Text variant="labelSmall" style={styles.sectionLabel}>
            Allergies
          </Text>
          <View style={styles.chipsRow}>
            {plan.allergies.map((a) => (
              <Chip
                key={a}
                compact
                style={{ backgroundColor: theme.colors.errorContainer }}
                textStyle={{ color: theme.colors.onErrorContainer }}
              >
                {a}
              </Chip>
            ))}
          </View>
        </View>
      )}

      {plan.goals.length > 0 && (
        <View style={styles.section}>
          <Text variant="labelSmall" style={styles.sectionLabel}>
            Objectifs
          </Text>
          <View style={styles.chipsRow}>
            {plan.goals.map((g) => (
              <Chip
                key={g}
                compact
                style={{ backgroundColor: theme.colors.tertiaryContainer }}
                textStyle={{ color: theme.colors.onTertiaryContainer }}
              >
                {GOAL_LABELS[g] ?? g}
              </Chip>
            ))}
          </View>
        </View>
      )}

      {slots.length > 0 && (
        <View style={styles.section}>
          <Text variant="labelSmall" style={styles.sectionLabel}>
            Composants par repas
          </Text>
          {slots.map(([slotKey, comps]) => (
            <View key={slotKey} style={styles.slotLine}>
              <Text style={styles.slotName}>{SLOT_LABELS[slotKey] ?? slotKey}</Text>
              <View style={styles.chipsRow}>
                {(comps ?? []).map((c) => (
                  <Chip
                    key={c.id}
                    compact
                    style={{ backgroundColor: theme.colors.surfaceVariant }}
                    textStyle={{ color: theme.colors.onSurfaceVariant }}
                  >
                    {`${emojiFor(c)} ${c.label}${c.required ? '' : ' ?'}`}
                  </Chip>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}

      {plan.regimes.length === 0 &&
        plan.allergies.length === 0 &&
        plan.goals.length === 0 &&
        slots.length === 0 && (
          <Text style={{ color: theme.colors.onSurfaceVariant, fontStyle: 'italic' }}>
            Profil non rempli.
          </Text>
        )}
    </Surface>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 16, gap: 12 },
  card: { padding: 16, borderRadius: 14, gap: 8 },
  cardTitle: { fontWeight: '700' },
  section: { gap: 4 },
  sectionLabel: {
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.6,
    marginTop: 4,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  slotLine: { gap: 2, marginTop: 4 },
  slotName: { fontWeight: '600', fontSize: 13 },
});
