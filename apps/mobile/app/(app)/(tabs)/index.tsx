import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { Topbar } from '@/components/Topbar';
import { useAuth } from '@/hooks/useAuth';
import { useMe } from '@/hooks/useMe';
import { usePlannings } from '@/hooks/usePlannings';
import { useRecipes } from '@/hooks/useRecipes';
import { ApiError, fetchHealth } from '@/lib/api';
import { useActiveHousehold } from '@/stores/activeHousehold';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Chip,
  IconButton,
  Surface,
  Text,
  TouchableRipple,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const me = useMe(!!session);
  const householdId = useActiveHousehold((s) => s.householdId);
  const recipes = useRecipes(householdId);
  const plannings = usePlannings(householdId);

  const greetingName = (() => {
    const m = me.data?.households.find((h) => h.id === householdId);
    if (m?.name) return m.name;
    return session?.user.email?.split('@')[0] ?? 'la famille';
  })();

  const recipeCount = recipes.data?.items.length ?? 0;
  const activePlanning = plannings.data?.find((p) => p.status === 'active') ?? null;

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
      edges={['top']}
    >
      <Topbar
        right={
          <IconButton
            icon="bell-outline"
            size={22}
            onPress={() => undefined}
            iconColor={theme.colors.onSurfaceVariant}
          />
        }
      />

      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={
              (me.isFetching && !me.isPending) ||
              (recipes.isFetching && !recipes.isPending) ||
              (plannings.isFetching && !plannings.isPending)
            }
            onRefresh={() => {
              void me.refetch();
              void recipes.refetch();
              void plannings.refetch();
            }}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* Bandeau de bienvenue, FamilyWall-like */}
        <Surface
          elevation={0}
          style={[styles.welcomeBanner, { backgroundColor: theme.colors.primary }]}
        >
          <View style={{ flex: 1 }}>
            <Text
              variant="titleSmall"
              style={[styles.welcomeHi, { color: theme.colors.onPrimary }]}
            >
              Bonjour 👋
            </Text>
            <Text
              variant="headlineSmall"
              style={[styles.welcomeName, { color: theme.colors.onPrimary }]}
            >
              {greetingName}
            </Text>
            <Text
              variant="bodySmall"
              style={[styles.welcomeSub, { color: theme.colors.onPrimary }]}
            >
              Voici ce qui se passe cette semaine
            </Text>
          </View>
          <Text style={styles.welcomeEmoji}>🍃</Text>
        </Surface>

        {/* Checklist d'onboarding (ne s'affiche que tant qu'il reste des etapes a faire) */}
        <OnboardingChecklist />

        {/* Modules colores - 2x2 grid */}
        <View style={styles.modulesGrid}>
          <ModuleTile
            icon="silverware-fork-knife"
            title="Repas"
            count={activePlanning ? 'Actif' : '0'}
            subtitle="Cette semaine"
            color={theme.colors.primary}
            bg={theme.colors.primaryContainer}
            onPress={() => router.push('/(app)/(tabs)/planning')}
          />
          <ModuleTile
            icon="book-open-variant"
            title="Recettes"
            count={recipes.isPending ? '—' : String(recipeCount)}
            subtitle="Bibliotheque"
            color={theme.colors.secondary}
            bg={theme.colors.secondaryContainer}
            onPress={() => router.push('/(app)/(tabs)/recipes')}
          />
          <ModuleTile
            icon="cart-outline"
            title="Courses"
            count="—"
            subtitle="Liste auto"
            color={theme.colors.tertiary}
            bg={theme.colors.tertiaryContainer}
            onPress={() =>
              activePlanning
                ? router.push(`/(app)/(tabs)/planning/${activePlanning.id}/shopping`)
                : router.push('/(app)/(tabs)/planning')
            }
          />
          <ModuleTile
            icon="leaf"
            title="Nutrition"
            count="—"
            subtitle="Bientot"
            color="#5B7CB1"
            bg="#E1EAF7"
            onPress={() => router.push('/(app)/(tabs)/profile')}
            disabled
          />
        </View>

        {/* Section : Cette semaine */}
        <SectionHeader
          title="Cette semaine"
          actionLabel={activePlanning ? 'Voir' : 'Creer'}
          onAction={() =>
            activePlanning
              ? router.push(`/(app)/(tabs)/planning/${activePlanning.id}`)
              : router.push('/(app)/(tabs)/planning')
          }
        />
        {activePlanning ? (
          <TouchableRipple
            borderless
            onPress={() => router.push(`/(app)/(tabs)/planning/${activePlanning.id}`)}
            style={[styles.weekCard, { backgroundColor: theme.colors.surface }]}
          >
            <View style={styles.weekCardInner}>
              <Surface
                elevation={0}
                style={[styles.weekIcon, { backgroundColor: theme.colors.primaryContainer }]}
              >
                <MaterialCommunityIcons
                  name="calendar-check"
                  size={28}
                  color={theme.colors.primary}
                />
              </Surface>
              <View style={{ flex: 1 }}>
                <Text variant="titleMedium" style={styles.weekTitle}>
                  {activePlanning.name}
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
                >
                  Du {activePlanning.startDate} au {activePlanning.endDate}
                </Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={24}
                color={theme.colors.onSurfaceVariant}
              />
            </View>
          </TouchableRipple>
        ) : (
          <Surface
            elevation={0}
            style={[styles.placeholderCard, { backgroundColor: theme.colors.surface }]}
          >
            <Text style={styles.placeholderEmoji}>📅</Text>
            <Text variant="titleMedium" style={styles.placeholderTitle}>
              Pas encore de planning
            </Text>
            <Text
              variant="bodySmall"
              style={[styles.placeholderBody, { color: theme.colors.onSurfaceVariant }]}
            >
              Composez vos repas de la semaine, ou laissez l'IA proposer un menu equilibre.
            </Text>
          </Surface>
        )}

        {/* Section : Recettes recentes */}
        <SectionHeader
          title="Recettes recentes"
          actionLabel="Tout voir"
          onAction={() => router.push('/(app)/(tabs)/recipes')}
        />
        {recipes.isPending && (
          <View style={styles.recipesLoader}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
          </View>
        )}
        {recipes.isSuccess && recipeCount === 0 && (
          <Surface
            elevation={0}
            style={[styles.placeholderCard, { backgroundColor: theme.colors.surface }]}
          >
            <Text style={styles.placeholderEmoji}>📖</Text>
            <Text variant="titleMedium" style={styles.placeholderTitle}>
              Aucune recette
            </Text>
            <Text
              variant="bodySmall"
              style={[styles.placeholderBody, { color: theme.colors.onSurfaceVariant }]}
            >
              Ajoutez vos classiques familiaux ou creez-en avec l'aide de l'IA.
            </Text>
          </Surface>
        )}
        {recipes.isSuccess && recipeCount > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recipesRow}
          >
            {recipes.data.items.slice(0, 8).map((r) => (
              <TouchableRipple
                key={r.id}
                onPress={() => router.push(`/(app)/(tabs)/recipes/${r.id}`)}
                borderless
                style={[styles.recipeCard, { backgroundColor: theme.colors.surface }]}
              >
                <View>
                  <Surface
                    elevation={0}
                    style={[styles.recipeThumb, { backgroundColor: theme.colors.primaryContainer }]}
                  >
                    <Text style={styles.recipeEmoji}>🍲</Text>
                  </Surface>
                  <Text variant="titleSmall" numberOfLines={2} style={styles.recipeName}>
                    {r.title}
                  </Text>
                  <Text
                    variant="labelSmall"
                    style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
                  >
                    {r.servings} pers.
                    {(r.prepTimeMin ?? 0) + (r.cookTimeMin ?? 0) > 0 &&
                      ` · ${(r.prepTimeMin ?? 0) + (r.cookTimeMin ?? 0)} min`}
                  </Text>
                </View>
              </TouchableRipple>
            ))}
          </ScrollView>
        )}

        <DiagnosticChip />
      </ScrollView>
    </SafeAreaView>
  );
}

function ModuleTile({
  icon,
  title,
  count,
  subtitle,
  color,
  bg,
  onPress,
  disabled,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  count: string;
  subtitle: string;
  color: string;
  bg: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableRipple
      onPress={onPress}
      disabled={disabled}
      borderless
      style={[styles.moduleTile, { backgroundColor: bg, opacity: disabled ? 0.6 : 1 }]}
    >
      <View>
        <View style={styles.moduleTileHeader}>
          <Surface
            elevation={0}
            style={[styles.moduleIconBubble, { backgroundColor: '#FFFFFFCC' }]}
          >
            <MaterialCommunityIcons name={icon} size={22} color={color} />
          </Surface>
          <Text variant="headlineSmall" style={[styles.moduleCount, { color }]}>
            {count}
          </Text>
        </View>
        <Text variant="titleMedium" style={[styles.moduleTitle, { color }]}>
          {title}
        </Text>
        <Text variant="bodySmall" style={[styles.moduleSubtitle, { color }]}>
          {subtitle}
        </Text>
      </View>
    </TouchableRipple>
  );
}

function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text variant="titleMedium" style={styles.sectionTitle}>
        {title}
      </Text>
      {actionLabel && onAction && (
        <TouchableRipple onPress={onAction} borderless style={styles.sectionAction}>
          <Text variant="labelMedium" style={{ color: theme.colors.primary, fontWeight: '700' }}>
            {actionLabel} →
          </Text>
        </TouchableRipple>
      )}
    </View>
  );
}

function DiagnosticChip() {
  const theme = useTheme();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    retry: 0,
  });
  return (
    <View style={styles.diagnosticRow}>
      {health.isPending && <ActivityIndicator size="small" />}
      {health.isSuccess && (
        <Chip
          compact
          icon="check-circle"
          style={{ backgroundColor: theme.colors.surfaceVariant }}
          textStyle={{ fontSize: 11, color: theme.colors.onSurfaceVariant }}
        >
          {`API ${health.data.version}`}
        </Chip>
      )}
      {health.isError && (
        <Chip
          compact
          icon="alert-circle"
          style={{ backgroundColor: theme.colors.errorContainer }}
          textStyle={{ fontSize: 11, color: theme.colors.onErrorContainer }}
        >
          {health.error instanceof ApiError ? `API ${health.error.status}` : 'API hors ligne'}
        </Chip>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 32,
    gap: 16,
  },

  welcomeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 24,
    minHeight: 110,
  },
  welcomeHi: { opacity: 0.9, fontWeight: '600' },
  welcomeName: { fontWeight: '800', marginTop: 2 },
  welcomeSub: { opacity: 0.85, marginTop: 4 },
  welcomeEmoji: { fontSize: 56 },

  modulesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  moduleTile: {
    width: '48.5%',
    minHeight: 130,
    borderRadius: 20,
    padding: 16,
  },
  moduleTileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  moduleIconBubble: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleCount: { fontWeight: '800' },
  moduleTitle: { fontWeight: '700' },
  moduleSubtitle: { opacity: 0.85, marginTop: 2 },

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: -4,
  },
  sectionTitle: { fontWeight: '700', letterSpacing: 0.2 },
  sectionAction: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
  },

  weekCard: { borderRadius: 18, padding: 14 },
  weekCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  weekIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekTitle: { fontWeight: '700' },

  placeholderCard: {
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
  },
  placeholderEmoji: { fontSize: 36, marginBottom: 8 },
  placeholderTitle: { fontWeight: '700', textAlign: 'center' },
  placeholderBody: { textAlign: 'center', marginTop: 4, paddingHorizontal: 8 },

  recipesLoader: { paddingVertical: 16, alignItems: 'center' },
  recipesRow: {
    paddingRight: 8,
    gap: 10,
  },
  recipeCard: {
    width: 150,
    padding: 10,
    borderRadius: 16,
  },
  recipeThumb: {
    width: '100%',
    aspectRatio: 1.4,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  recipeEmoji: { fontSize: 30 },
  recipeName: { fontWeight: '700' },

  diagnosticRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
});
