import { makeDietCheckKey, useDietChecks } from '@/stores/dietChecks';
import type { DietAlternative, DietComponent } from '@mealendar/shared';
import { StyleSheet, View } from 'react-native';
import { Button, Checkbox, Surface, Text, TouchableRipple, useTheme } from 'react-native-paper';

const CATEGORY_EMOJI: Record<string, string> = {
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

export type DietPlanChecklistProps = {
  planningId: string;
  date: string;
  slotKey: string;
  components: DietComponent[];
  /**
   * Si fourni, affiche un bouton "Generer une recette pour ce slot" qui transmet
   * les composants au LLM.
   */
  onGenerateForSlot?: (components: DietComponent[]) => void;
};

// Singleton pour eviter qu'un nouveau [] soit cree a chaque render
// (ce qui ferait detecter un changement de snapshot a useSyncExternalStore -> boucle infinie).
const EMPTY_CHECKED: readonly string[] = Object.freeze([]);

export function DietPlanChecklist({
  planningId,
  date,
  slotKey,
  components,
  onGenerateForSlot,
}: DietPlanChecklistProps) {
  const theme = useTheme();
  const key = makeDietCheckKey(planningId, date, slotKey);
  // On selectionne directement le tableau complet et on calcule le sous-tableau
  // dans un useMemo stable (la ref ne change que si la map a vraiment change).
  const allChecked = useDietChecks((s) => s.checked);
  const toggle = useDietChecks((s) => s.toggle);
  const checked = allChecked[key] ?? EMPTY_CHECKED;

  if (components.length === 0) return null;

  const checkedCount = components.filter((c) => checked.includes(c.id)).length;

  return (
    <Surface
      elevation={0}
      style={[styles.container, { backgroundColor: theme.colors.surfaceVariant }]}
    >
      <View style={styles.header}>
        <Text
          variant="labelMedium"
          style={[styles.title, { color: theme.colors.onSurfaceVariant }]}
        >
          📋 Plan alimentaire
        </Text>
        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {checkedCount}/{components.length}
        </Text>
      </View>
      {components.map((comp) => {
        const isChecked = checked.includes(comp.id);
        return (
          <TouchableRipple
            key={comp.id}
            onPress={() => toggle(key, comp.id)}
            borderless
            style={styles.row}
          >
            <View style={styles.rowInner}>
              <Checkbox.Android
                status={isChecked ? 'checked' : 'unchecked'}
                onPress={() => toggle(key, comp.id)}
              />
              <View style={{ flex: 1 }}>
                <Text
                  variant="bodyMedium"
                  style={[
                    styles.compLabel,
                    isChecked && {
                      textDecorationLine: 'line-through',
                      color: theme.colors.onSurfaceVariant,
                    },
                  ]}
                >
                  {comp.label}
                  {!comp.required && (
                    <Text style={{ color: theme.colors.onSurfaceVariant, fontWeight: '400' }}>
                      {' (optionnel)'}
                    </Text>
                  )}
                </Text>
                <Text
                  variant="labelSmall"
                  style={{ color: theme.colors.onSurfaceVariant }}
                  numberOfLines={2}
                >
                  {comp.alternatives.map(formatAlternative).join('  •  ')}
                </Text>
                {comp.note && (
                  <Text
                    variant="labelSmall"
                    style={{
                      color: theme.colors.onSurfaceVariant,
                      fontStyle: 'italic',
                      marginTop: 2,
                    }}
                  >
                    {comp.note}
                  </Text>
                )}
              </View>
            </View>
          </TouchableRipple>
        );
      })}

      {onGenerateForSlot && (
        <Button
          mode="contained-tonal"
          icon="auto-fix"
          compact
          onPress={() => onGenerateForSlot(components)}
          style={styles.generateBtn}
        >
          Generer une recette pour ce slot
        </Button>
      )}
    </Surface>
  );
}

function formatAlternative(alt: DietAlternative): string {
  const emoji = CATEGORY_EMOJI[alt.category] ?? '';
  const qty =
    alt.qtyMin != null && alt.qtyMax != null && alt.qtyMin !== alt.qtyMax
      ? ` ${alt.qtyMin}-${alt.qtyMax}`
      : alt.qtyMin != null
        ? ` ${alt.qtyMin}`
        : alt.qtyMax != null
          ? ` ${alt.qtyMax}`
          : '';
  const unit = alt.unit ? alt.unit : '';
  return `${emoji} ${alt.label}${qty}${unit ? ` ${unit}` : ''}`;
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 10,
    gap: 4,
    marginTop: 6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  title: { fontWeight: '700', letterSpacing: 0.3 },
  row: { borderRadius: 8 },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    paddingVertical: 4,
    paddingRight: 8,
  },
  compLabel: { fontWeight: '600' },
  generateBtn: {
    marginTop: 8,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
});
