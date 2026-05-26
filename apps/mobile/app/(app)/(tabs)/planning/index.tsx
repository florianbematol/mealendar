import { EmptyState } from '@/components/EmptyState';
import { Topbar } from '@/components/Topbar';
import { useCreatePlanning, useMealPlan, usePlannings } from '@/hooks/usePlannings';
import { ApiError } from '@/lib/api';
import { addDays, formatShortDate, startOfWeek, todayIso } from '@/lib/dates';
import { useActiveHousehold } from '@/stores/activeHousehold';
import type { Planning } from '@mealendar/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  HelperText,
  IconButton,
  Surface,
  Text,
  TouchableRipple,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PlanningIndexScreen() {
  const theme = useTheme();
  const householdId = useActiveHousehold((s) => s.householdId);
  const plannings = usePlannings(householdId);
  const mealPlan = useMealPlan(householdId);
  const createPlanning = useCreatePlanning();
  const [error, setError] = useState<string | null>(null);

  // Resume du plan-type : nb de slots configures sur la semaine
  const slotsPerWeek = mealPlan.data
    ? Object.values(mealPlan.data.slotConfig).reduce(
        (acc, daySlots) => acc + (daySlots?.length ?? 0),
        0,
      )
    : 0;

  // Resume du plan alimentaire : nb de composants au total + nb de regles journalieres
  const dietComponentsCount = mealPlan.data?.dietPlan
    ? Object.values(mealPlan.data.dietPlan.slots).reduce(
        (acc, comps) => acc + (comps?.length ?? 0),
        0,
      )
    : 0;
  const dietRulesCount = mealPlan.data?.dietPlan?.dailyRules?.length ?? 0;

  const onCreateThisWeek = async () => {
    if (!householdId) return;
    setError(null);
    const start = startOfWeek(todayIso());
    const end = addDays(start, 6);
    try {
      const p = await createPlanning.mutateAsync({
        householdId,
        startDate: start,
        endDate: end,
        mealPlanId: mealPlan.data?.id ?? null,
        name: `Semaine du ${formatShortDate(start)}`,
      });
      router.push(`/(app)/(tabs)/planning/${p.id}`);
    } catch (e) {
      if (e instanceof ApiError) setError(`${e.status} - ${e.message}`);
      else setError(e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
      edges={['top']}
    >
      <Topbar
        right={
          <IconButton
            icon="cog-outline"
            size={22}
            onPress={() => router.push('/(app)/(tabs)/planning/meal-plan')}
            iconColor={theme.colors.onSurfaceVariant}
          />
        }
      />

      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={plannings.isFetching && !plannings.isPending}
            onRefresh={() => {
              void plannings.refetch();
              void mealPlan.refetch();
            }}
            tintColor={theme.colors.primary}
          />
        }
      >
        <View style={styles.header}>
          <Text variant="titleLarge" style={styles.title}>
            Planning
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Composez votre semaine ou laissez la magie operer.
          </Text>
        </View>

        {/* Setup section : etat de configuration du foyer */}
        <SetupSection
          mealPlanConfigured={!!mealPlan.data}
          dietPlanConfigured={!!mealPlan.data?.dietPlan}
          mealPlanSummary={mealPlan.data ? `${slotsPerWeek} repas / semaine` : null}
          dietPlanSummary={
            mealPlan.data?.dietPlan
              ? `${dietComponentsCount} composant${dietComponentsCount > 1 ? 's' : ''}${
                  dietRulesCount > 0
                    ? ` · ${dietRulesCount} regle${dietRulesCount > 1 ? 's' : ''}`
                    : ''
                }`
              : null
          }
          onMealPlanPress={() => router.push('/(app)/(tabs)/planning/meal-plan')}
          onDietPlanPress={() => router.push('/(app)/(tabs)/planning/diet-plan')}
        />

        {/* Action principale */}
        <Button
          mode="contained"
          icon="calendar-plus"
          onPress={onCreateThisWeek}
          loading={createPlanning.isPending}
          disabled={createPlanning.isPending}
          style={styles.createBtn}
          contentStyle={styles.createBtnContent}
        >
          Nouveau planning - Cette semaine
        </Button>

        {error && (
          <HelperText type="error" visible>
            {error}
          </HelperText>
        )}

        {/* Liste des plannings existants */}
        <View style={styles.listSection}>
          <Text variant="labelLarge" style={styles.sectionTitle}>
            Mes plannings
          </Text>
          {plannings.isPending && (
            <View style={styles.loaderRow}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
            </View>
          )}
          {plannings.isSuccess && plannings.data.length === 0 && (
            <EmptyState
              icon="calendar-blank"
              title="Pas encore de planning"
              description="Creez votre premier planning pour la semaine et generez automatiquement les repas a partir de vos recettes."
              cta={{
                label: 'Creer cette semaine',
                icon: 'calendar-plus',
                onPress: onCreateThisWeek,
              }}
            />
          )}
          {plannings.isSuccess &&
            plannings.data.map((p) => <PlanningRow key={p.id} planning={p} />)}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ============================================================================
// SetupSection : etat de configuration du foyer (semaine type + plan alimentaire)
//
// 2 modes selon l'etat :
//  - "fresh" (rien configure) : grand encart accueillant avec checklist visuelle
//                                qui guide l'utilisateur dans le setup
//  - "ready" (semaine type OK) : ligne discrete avec resumes et lien Modifier
// ============================================================================
function SetupSection({
  mealPlanConfigured,
  dietPlanConfigured,
  mealPlanSummary,
  dietPlanSummary,
  onMealPlanPress,
  onDietPlanPress,
}: {
  mealPlanConfigured: boolean;
  dietPlanConfigured: boolean;
  mealPlanSummary: string | null;
  dietPlanSummary: string | null;
  onMealPlanPress: () => void;
  onDietPlanPress: () => void;
}) {
  const theme = useTheme();

  // Compact : tout est configure -> ligne discrete avec 2 chips et acces Modifier
  if (mealPlanConfigured && dietPlanConfigured) {
    return (
      <Surface
        elevation={0}
        style={[styles.compactCard, { backgroundColor: theme.colors.surface }]}
      >
        <View style={styles.compactRow}>
          <View style={styles.compactItem}>
            <Text
              variant="labelSmall"
              style={[styles.compactLabel, { color: theme.colors.onSurfaceVariant }]}
            >
              Semaine type
            </Text>
            <Text variant="bodyMedium" style={styles.compactValue}>
              {mealPlanSummary}
            </Text>
          </View>
          <View style={[styles.compactDivider, { backgroundColor: theme.colors.outlineVariant }]} />
          <View style={styles.compactItem}>
            <Text
              variant="labelSmall"
              style={[styles.compactLabel, { color: theme.colors.onSurfaceVariant }]}
            >
              Plan alimentaire
            </Text>
            <Text variant="bodyMedium" style={styles.compactValue}>
              {dietPlanSummary}
            </Text>
          </View>
          <IconButton
            icon="cog-outline"
            size={20}
            onPress={onMealPlanPress}
            iconColor={theme.colors.onSurfaceVariant}
            style={styles.compactCog}
          />
        </View>
        <View style={styles.compactActions}>
          <Button mode="text" compact onPress={onMealPlanPress}>
            Semaine type
          </Button>
          <Button mode="text" compact onPress={onDietPlanPress}>
            Plan alimentaire
          </Button>
        </View>
      </Surface>
    );
  }

  // Fresh : checklist guidante
  const totalSteps = 2;
  const doneSteps = (mealPlanConfigured ? 1 : 0) + (dietPlanConfigured ? 1 : 0);
  const progressPct = (doneSteps / totalSteps) * 100;

  return (
    <Surface elevation={0} style={[styles.setupCard, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.setupHeader}>
        <View style={{ flex: 1 }}>
          <Text variant="titleMedium" style={styles.setupTitle}>
            Configurez votre foyer
          </Text>
          <Text
            variant="bodySmall"
            style={[styles.setupSubtitle, { color: theme.colors.onSurfaceVariant }]}
          >
            Definissez votre rythme de repas pour generer des plannings adaptes.
          </Text>
        </View>
        <View style={styles.setupProgressBlock}>
          <Text
            variant="labelMedium"
            style={[styles.setupProgressText, { color: theme.colors.primary }]}
          >
            {doneSteps}/{totalSteps}
          </Text>
        </View>
      </View>

      <View style={[styles.progressBar, { backgroundColor: theme.colors.surfaceVariant }]}>
        <View
          style={[
            styles.progressBarFill,
            { width: `${progressPct}%`, backgroundColor: theme.colors.primary },
          ]}
        />
      </View>

      <View style={styles.stepsList}>
        <SetupStep
          icon="calendar-week"
          title="Semaine type"
          description={
            mealPlanConfigured
              ? (mealPlanSummary ?? 'Configure')
              : 'Quels repas planifier chaque jour de la semaine ?'
          }
          done={mealPlanConfigured}
          required
          onPress={onMealPlanPress}
        />
        <SetupStep
          icon="leaf"
          title="Plan alimentaire"
          description={
            dietPlanConfigured
              ? (dietPlanSummary ?? 'Configure')
              : 'Composants attendus dans chaque repas (legumes, proteine, feculents...)'
          }
          done={dietPlanConfigured}
          required={false}
          locked={!mealPlanConfigured}
          onPress={onDietPlanPress}
        />
      </View>
    </Surface>
  );
}

function SetupStep({
  icon,
  title,
  description,
  done,
  required,
  locked,
  onPress,
}: {
  icon: string;
  title: string;
  description: string;
  done: boolean;
  required: boolean;
  locked?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const bubbleColor = done
    ? theme.colors.primary
    : locked
      ? theme.colors.surfaceVariant
      : theme.colors.primaryContainer;
  const iconColor = done
    ? theme.colors.onPrimary
    : locked
      ? theme.colors.onSurfaceVariant
      : theme.colors.primary;

  return (
    <TouchableRipple
      onPress={locked ? undefined : onPress}
      disabled={locked}
      borderless
      style={[styles.step, locked && styles.stepLocked]}
    >
      <View style={styles.stepInner}>
        <View style={[styles.stepBubble, { backgroundColor: bubbleColor }]}>
          {done ? (
            <Text style={[styles.stepCheck, { color: iconColor }]}>✓</Text>
          ) : (
            <IconButton
              icon={locked ? 'lock-outline' : icon}
              size={18}
              iconColor={iconColor}
              style={styles.stepBubbleIcon}
              disabled
            />
          )}
        </View>
        <View style={styles.stepBody}>
          <View style={styles.stepTitleRow}>
            <Text variant="titleSmall" style={styles.stepTitle}>
              {title}
            </Text>
            {!required && !done && (
              <Text
                variant="labelSmall"
                style={[styles.stepBadge, { color: theme.colors.onSurfaceVariant }]}
              >
                Optionnel
              </Text>
            )}
            {done && (
              <Text
                variant="labelSmall"
                style={[styles.stepBadge, { color: theme.colors.primary, fontWeight: '700' }]}
              >
                Pret
              </Text>
            )}
          </View>
          <Text
            variant="bodySmall"
            numberOfLines={2}
            style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
          >
            {description}
          </Text>
        </View>
        {!locked && (
          <Text style={[styles.stepChevron, { color: theme.colors.onSurfaceVariant }]}>›</Text>
        )}
      </View>
    </TouchableRipple>
  );
}

function PlanningRow({ planning }: { planning: Planning }) {
  const theme = useTheme();
  return (
    <TouchableRipple
      onPress={() => router.push(`/(app)/(tabs)/planning/${planning.id}`)}
      borderless
      style={[styles.planningRow, { backgroundColor: theme.colors.surface }]}
    >
      <View style={styles.planningRowInner}>
        <Surface
          elevation={0}
          style={[styles.planningThumb, { backgroundColor: theme.colors.primaryContainer }]}
        >
          <Text style={styles.planningEmoji}>📆</Text>
        </Surface>
        <View style={{ flex: 1 }}>
          <Text variant="titleMedium" style={styles.planningName} numberOfLines={1}>
            {planning.name}
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {formatShortDate(planning.startDate)} → {formatShortDate(planning.endDate)}
          </Text>
        </View>
        <Chip
          compact
          style={{
            backgroundColor:
              planning.status === 'active'
                ? theme.colors.primaryContainer
                : theme.colors.surfaceVariant,
          }}
          textStyle={styles.statusChipText}
        >
          {planning.status === 'active' ? 'Actif' : planning.status}
        </Chip>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    padding: 16,
    gap: 16,
    paddingBottom: 32,
  },
  header: { gap: 2, paddingTop: 4 },
  title: { fontWeight: '700' },
  createBtn: {
    borderRadius: 12,
  },
  createBtnContent: { paddingVertical: 6 },
  listSection: { gap: 8 },
  sectionTitle: { fontWeight: '700', letterSpacing: 0.3 },
  empty: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  emptyEmoji: { fontSize: 36, marginBottom: 8 },
  emptyTitle: { fontWeight: '700' },
  emptyBody: { textAlign: 'center', marginTop: 4 },
  loaderRow: { padding: 16, alignItems: 'center' },
  planningRow: {
    padding: 12,
    borderRadius: 14,
    marginBottom: 8,
  },
  planningRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  planningThumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planningEmoji: { fontSize: 22 },
  planningName: { fontWeight: '700' },
  statusChipText: { fontSize: 11 },

  // SetupSection - mode "fresh"
  setupCard: {
    padding: 16,
    borderRadius: 18,
    gap: 12,
  },
  setupHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  setupTitle: { fontWeight: '700' },
  setupSubtitle: { marginTop: 4, lineHeight: 18 },
  setupProgressBlock: {
    minWidth: 36,
    alignItems: 'flex-end',
  },
  setupProgressText: { fontWeight: '800', fontSize: 14 },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  stepsList: { gap: 4, marginTop: 4 },
  step: {
    borderRadius: 12,
  },
  stepLocked: { opacity: 0.55 },
  stepInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  stepBubble: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBubbleIcon: { margin: 0 },
  stepCheck: { fontSize: 18, fontWeight: '800' },
  stepBody: { flex: 1 },
  stepTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepTitle: { fontWeight: '700' },
  stepBadge: {
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  stepChevron: { fontSize: 22, lineHeight: 22, paddingHorizontal: 4 },

  // SetupSection - mode "compact" (tout configure)
  compactCard: {
    padding: 14,
    borderRadius: 16,
    gap: 8,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  compactItem: { flex: 1 },
  compactLabel: {
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontSize: 10,
  },
  compactValue: { fontWeight: '700', marginTop: 2 },
  compactDivider: { width: 1, height: 32 },
  compactCog: { margin: 0 },
  compactActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 4,
  },
});
