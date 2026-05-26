import type { RecipeMacros } from '@/lib/macros';
import { StyleSheet, View } from 'react-native';
import { Surface, Text, useTheme } from 'react-native-paper';

export type NutritionCardProps = {
  macros: RecipeMacros;
  servings: number;
  perServing?: boolean;
};

/**
 * Carte de macros nutritionnelles : kcal en grand a gauche, P/G/L/F en barres a droite.
 */
export function NutritionCard({ macros, servings, perServing = true }: NutritionCardProps) {
  const theme = useTheme();
  const m = perServing ? macros.perServing : macros.perRecipe;
  const totalGrams = m.proteinG + m.carbsG + m.fatG;
  const safeTotal = Math.max(totalGrams, 1);
  const pctP = (m.proteinG / safeTotal) * 100;
  const pctC = (m.carbsG / safeTotal) * 100;
  const pctF = (m.fatG / safeTotal) * 100;

  return (
    <Surface elevation={0} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
      <View style={styles.headerRow}>
        <Text variant="labelLarge" style={styles.title}>
          Nutrition
        </Text>
        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {perServing ? `par portion (1/${servings})` : 'pour toute la recette'}
        </Text>
      </View>

      <View style={styles.body}>
        <View style={styles.kcalBlock}>
          <Text variant="displaySmall" style={[styles.kcalNum, { color: theme.colors.primary }]}>
            {m.kcal}
          </Text>
          <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            kcal
          </Text>
        </View>

        <View style={styles.macros}>
          <MacroLine label="Proteines" value={m.proteinG} pct={pctP} color={theme.colors.primary} />
          <MacroLine label="Glucides" value={m.carbsG} pct={pctC} color={theme.colors.tertiary} />
          <MacroLine label="Lipides" value={m.fatG} pct={pctF} color={theme.colors.secondary} />
          {m.fiberG > 0 && (
            <MacroLine
              label="Fibres"
              value={m.fiberG}
              pct={0}
              color={theme.colors.onSurfaceVariant}
              showBar={false}
            />
          )}
        </View>
      </View>

      {macros.incomplete && (
        <Text
          variant="labelSmall"
          style={[styles.warning, { color: theme.colors.onSurfaceVariant }]}
        >
          ⚠ Estimation partielle ({macros.contributingCount}/{macros.totalCount} ingredients
          contribuent)
        </Text>
      )}
    </Surface>
  );
}

function MacroLine({
  label,
  value,
  pct,
  color,
  showBar = true,
}: {
  label: string;
  value: number;
  pct: number;
  color: string;
  showBar?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.macroRow}>
      <View style={styles.macroLabelRow}>
        <Text variant="labelMedium" style={{ color: theme.colors.onSurface }}>
          {label}
        </Text>
        <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
          {`${value} g`}
        </Text>
      </View>
      {showBar && (
        <View style={[styles.barTrack, { backgroundColor: theme.colors.surfaceVariant }]}>
          <View
            style={[
              styles.barFill,
              { width: `${Math.min(100, Math.max(2, pct))}%`, backgroundColor: color },
            ]}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  title: { fontWeight: '700', letterSpacing: 0.3 },
  body: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
  },
  kcalBlock: {
    alignItems: 'center',
    minWidth: 80,
  },
  kcalNum: { fontWeight: '800' },
  macros: { flex: 1, gap: 8 },
  macroRow: { gap: 4 },
  macroLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 3 },
  warning: { textAlign: 'center', marginTop: 4 },
});
