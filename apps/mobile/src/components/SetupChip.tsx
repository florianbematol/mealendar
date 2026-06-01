/**
 * SetupChip + SetupSheet
 *
 * Pattern recommande par l'analyse UX :
 *  - Une Chip dans la title row de la page Planning indique l'etat de
 *    configuration (Configurer 1/2 / Pret / Reglages)
 *  - Un tap ouvre une bottom sheet avec la checklist detaillee
 *  - L'ancien SetupSection inline (trop volumineux ~220px sur la page
 *    Planning) est extrait ici pour liberer la viewport.
 *
 * Source : task subagent_type=general (PR feat/calendar-libre).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Button,
  Chip,
  IconButton,
  Modal,
  Portal,
  ProgressBar,
  Surface,
  Text,
  TouchableRipple,
  useTheme,
} from 'react-native-paper';

type SetupState = {
  mealPlanConfigured: boolean;
  dietPlanConfigured: boolean;
  mealPlanSummary: string | null;
  dietPlanSummary: string | null;
};

// ============================================================================
// SetupChip : entry point compact dans la title row.
//
// 3 etats visuels (cf. spec) :
//  - incomplet (0/2 ou 1/2) : tertiaryContainer, label "Configurer · N/2"
//  - complet : outlined, icon "tune-vertical", label "Reglages"
//  - loading : ActivityIndicator, label "..."
//
// Si `iconOnly` est true, on n'affiche que l'icone (pour gagner de la place
// dans une title row chargee). Le badge "1/2" est conserve sous forme de
// petit dot terracotta sur l'icone si le setup est incomplet.
// ============================================================================
export function SetupChip(props: SetupState & { loading?: boolean; iconOnly?: boolean }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const totalSteps = 2;
  const doneSteps = (props.mealPlanConfigured ? 1 : 0) + (props.dietPlanConfigured ? 1 : 0);
  const isComplete = doneSteps === totalSteps;

  if (props.loading) {
    if (props.iconOnly) {
      return <IconButton icon="dots-horizontal" size={22} disabled />;
    }
    return (
      <Chip compact icon="dots-horizontal" disabled>
        ...
      </Chip>
    );
  }

  if (props.iconOnly) {
    return (
      <>
        <View>
          <IconButton
            icon={isComplete ? 'tune-vertical' : 'cog-play-outline'}
            size={22}
            iconColor={
              isComplete ? theme.colors.onSurfaceVariant : theme.colors.onTertiaryContainer
            }
            containerColor={isComplete ? undefined : theme.colors.tertiaryContainer}
            onPress={() => setOpen(true)}
            style={{ margin: 0 }}
          />
          {!isComplete && (
            <View style={[styles.iconDot, { backgroundColor: theme.colors.tertiary }]} />
          )}
        </View>
        <SetupSheet visible={open} onDismiss={() => setOpen(false)} {...props} />
      </>
    );
  }

  return (
    <>
      <Chip
        compact
        icon={isComplete ? 'tune-vertical' : 'cog-play-outline'}
        onPress={() => setOpen(true)}
        mode={isComplete ? 'outlined' : 'flat'}
        style={{
          backgroundColor: isComplete ? theme.colors.surface : theme.colors.tertiaryContainer,
        }}
        textStyle={{
          color: isComplete ? theme.colors.onSurfaceVariant : theme.colors.onTertiaryContainer,
          fontWeight: isComplete ? '500' : '700',
        }}
      >
        {isComplete ? 'Reglages' : `Configurer · ${doneSteps}/${totalSteps}`}
      </Chip>

      <SetupSheet visible={open} onDismiss={() => setOpen(false)} {...props} />
    </>
  );
}

// ============================================================================
// SetupSheet : la bottom sheet qui contient la checklist complete.
// Reprend le contenu de l'ancien SetupSection (fresh mode) avec progress bar
// + 2 SetupStep cards.
// ============================================================================
function SetupSheet({
  visible,
  onDismiss,
  mealPlanConfigured,
  dietPlanConfigured,
  mealPlanSummary,
  dietPlanSummary,
}: SetupState & {
  visible: boolean;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const totalSteps = 2;
  const doneSteps = (mealPlanConfigured ? 1 : 0) + (dietPlanConfigured ? 1 : 0);

  const goTo = (path: string) => {
    onDismiss();
    // Petit delai pour que la sheet ferme avant la navigation (sinon le
    // header de la nouvelle page apparait pendant l'animation de fermeture).
    setTimeout(() => router.push(path as never), 150);
  };

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={styles.sheetWrapper}>
        <Surface elevation={2} style={[styles.sheet, { backgroundColor: theme.colors.surface }]}>
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text variant="titleLarge" style={{ fontWeight: '700' }}>
                Configuration du foyer
              </Text>
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
              >
                Definissez votre rythme de repas pour generer des plannings adaptes.
              </Text>
            </View>
            <IconButton icon="close" size={22} onPress={onDismiss} />
          </View>

          <View style={styles.progressBlock}>
            <Text variant="labelLarge" style={{ color: theme.colors.primary, fontWeight: '800' }}>
              {doneSteps} / {totalSteps}
            </Text>
            <ProgressBar
              progress={doneSteps / totalSteps}
              color={theme.colors.primary}
              style={{ height: 6, borderRadius: 3, marginTop: 6 }}
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
              onPress={() => goTo('/(app)/(tabs)/planning/meal-plan')}
            />
            <SetupStep
              icon="leaf"
              title="Plan alimentaire"
              description={
                dietPlanConfigured
                  ? (dietPlanSummary ?? 'Configure')
                  : 'Composants attendus (legumes, proteine, feculents...)'
              }
              done={dietPlanConfigured}
              required={false}
              locked={!mealPlanConfigured}
              onPress={() => goTo('/(app)/(tabs)/planning/diet-plan')}
            />
          </View>

          <Button mode="text" onPress={onDismiss} style={{ marginTop: 12, alignSelf: 'center' }}>
            {doneSteps === totalSteps ? 'Tout est bon' : 'Plus tard'}
          </Button>
        </Surface>
      </Modal>
    </Portal>
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
              size={20}
              iconColor={iconColor}
              style={styles.stepBubbleIcon}
              disabled
            />
          )}
        </View>
        <View style={styles.stepBody}>
          <View style={styles.stepTitleRow}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>
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

const styles = StyleSheet.create({
  iconDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sheetWrapper: {
    margin: 0,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingTop: 8,
  },
  progressBlock: {
    marginTop: 8,
    marginBottom: 16,
  },
  stepsList: { gap: 6 },
  step: { borderRadius: 12 },
  stepLocked: { opacity: 0.55 },
  stepInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  stepBubble: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBubbleIcon: { margin: 0 },
  stepCheck: { fontSize: 20, fontWeight: '800' },
  stepBody: { flex: 1 },
  stepTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBadge: {
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  stepChevron: { fontSize: 24, lineHeight: 24, paddingHorizontal: 4 },
});
