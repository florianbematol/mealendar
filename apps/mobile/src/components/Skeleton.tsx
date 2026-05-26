/**
 * Skeleton loader avec animation pulse. Affiche un placeholder gris qui
 * pulse en opacite pendant le chargement. Plus moderne et donne un meilleur
 * sens de structure que l'ActivityIndicator generique.
 *
 * Usage :
 *   <SkeletonCard height={80} />
 *   <SkeletonText width="60%" />
 *   <SkeletonRow count={3} />
 */
import { useEffect, useRef } from 'react';
import { Animated, type DimensionValue, StyleSheet, View } from 'react-native';
import { useTheme } from 'react-native-paper';

function useSkeletonOpacity() {
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

export type SkeletonProps = {
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  style?: object;
};

export function Skeleton({ width = '100%', height = 16, borderRadius = 6, style }: SkeletonProps) {
  const theme = useTheme();
  const opacity = useSkeletonOpacity();
  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: theme.colors.surfaceVariant,
          opacity,
        },
        style,
      ]}
    />
  );
}

/**
 * Skeleton card avec image carre + 2 lignes de texte (placeholder pour
 * une recette en chargement).
 */
export function SkeletonRecipeCard() {
  const theme = useTheme();
  const opacity = useSkeletonOpacity();
  return (
    <Animated.View style={[styles.recipeCard, { backgroundColor: theme.colors.surface, opacity }]}>
      <View style={[styles.recipeImage, { backgroundColor: theme.colors.surfaceVariant }]} />
      <View style={styles.recipeBody}>
        <View
          style={[styles.line, { backgroundColor: theme.colors.surfaceVariant, width: '70%' }]}
        />
        <View
          style={[
            styles.line,
            { backgroundColor: theme.colors.surfaceVariant, width: '40%', marginTop: 6 },
          ]}
        />
        <View style={styles.chipsRow}>
          <View style={[styles.chip, { backgroundColor: theme.colors.surfaceVariant }]} />
          <View
            style={[styles.chip, { backgroundColor: theme.colors.surfaceVariant, width: 60 }]}
          />
        </View>
      </View>
    </Animated.View>
  );
}

/**
 * Skeleton list : N cards alignees verticalement avec spacing.
 */
export function SkeletonRecipeList({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRecipeCard
          // biome-ignore lint/suspicious/noArrayIndexKey: liste statique skeleton
          key={i}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  recipeCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 16,
  },
  recipeImage: {
    width: 80,
    height: 80,
    borderRadius: 12,
  },
  recipeBody: {
    flex: 1,
    justifyContent: 'center',
  },
  line: {
    height: 14,
    borderRadius: 6,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  chip: {
    height: 22,
    width: 50,
    borderRadius: 11,
  },
  list: {
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
});
