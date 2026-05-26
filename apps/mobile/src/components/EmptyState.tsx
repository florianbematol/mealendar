/**
 * Empty state generique : grosse icone, titre, description, et CTA optionnel.
 *
 * Utilise sur les listes vides (recettes, plannings, plans alimentaires...)
 * pour offrir un guidance plus chaleureuse qu'un simple texte.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Surface, Text, useTheme } from 'react-native-paper';

export type EmptyStateProps = {
  /** Nom d'icone Material Community Icons (ex 'silverware-fork-knife', 'calendar-blank'). */
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  description?: string;
  cta?: {
    label: string;
    icon?: string;
    onPress: () => void;
    /** mode: 'contained' | 'contained-tonal' | 'outlined'. Defaut 'contained'. */
    mode?: 'contained' | 'contained-tonal' | 'outlined';
  };
  /** CTA secondaire (optionnel). */
  secondaryCta?: {
    label: string;
    icon?: string;
    onPress: () => void;
  };
  /** Contenu additionnel sous les CTA. */
  children?: ReactNode;
};

export function EmptyState({
  icon,
  title,
  description,
  cta,
  secondaryCta,
  children,
}: EmptyStateProps) {
  const theme = useTheme();
  return (
    <Surface elevation={0} style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      <View style={[styles.iconBubble, { backgroundColor: theme.colors.primaryContainer }]}>
        <MaterialCommunityIcons name={icon} size={42} color={theme.colors.onPrimaryContainer} />
      </View>
      <Text variant="titleMedium" style={styles.title}>
        {title}
      </Text>
      {description ? (
        <Text
          variant="bodyMedium"
          style={[styles.description, { color: theme.colors.onSurfaceVariant }]}
        >
          {description}
        </Text>
      ) : null}
      {cta ? (
        <Button
          mode={cta.mode ?? 'contained'}
          icon={cta.icon}
          onPress={cta.onPress}
          style={styles.cta}
          contentStyle={styles.ctaContent}
        >
          {cta.label}
        </Button>
      ) : null}
      {secondaryCta ? (
        <Button
          mode="text"
          icon={secondaryCta.icon}
          onPress={secondaryCta.onPress}
          style={styles.secondaryCta}
        >
          {secondaryCta.label}
        </Button>
      ) : null}
      {children}
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    gap: 8,
  },
  iconBubble: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  cta: {
    marginTop: 12,
    borderRadius: 12,
  },
  ctaContent: {
    paddingHorizontal: 8,
  },
  secondaryCta: {
    marginTop: 0,
  },
});
