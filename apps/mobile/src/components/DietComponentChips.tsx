/**
 * Affiche les composants requis du diet plan pour un slot, sous forme
 * de petits chips compacts (emoji + label).
 *
 * Cas d'usage : sur la vue semaine du planning, on indique discretement
 * les composants attendus par slot (ex : "Proteine, Legume, Feculent")
 * sans surcharger l'UI avec des cases a cocher.
 *
 * Pour cocher les composants, l'utilisateur passe par la page dediee
 * "Plan alimentaire".
 */
import type { DietCategory, DietComponent } from '@mealendar/shared';
import { StyleSheet, View } from 'react-native';
import { Chip, useTheme } from 'react-native-paper';

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

/**
 * Renvoie l'emoji a afficher pour un composant : prend la premiere alternative
 * (la plus representative). Si aucune, fallback "🍽️".
 */
function emojiFor(comp: DietComponent): string {
  const first = comp.alternatives[0];
  if (!first) return '🍽️';
  return CATEGORY_EMOJI[first.category] ?? '🍽️';
}

export type DietComponentChipsProps = {
  components: DietComponent[];
  /** Couleur de fond du conteneur parent (pour adapter les chips). */
  onContainerColor?: string;
};

export function DietComponentChips({ components, onContainerColor }: DietComponentChipsProps) {
  const theme = useTheme();
  if (components.length === 0) return null;
  return (
    <View style={styles.row}>
      {components.map((c) => {
        const opt = !c.required;
        return (
          <Chip
            key={c.id}
            compact
            style={[
              styles.chip,
              {
                backgroundColor: opt
                  ? theme.colors.surfaceVariant
                  : (onContainerColor ?? theme.colors.surface),
              },
            ]}
            textStyle={[
              styles.chipText,
              {
                color: opt ? theme.colors.onSurfaceVariant : theme.colors.onSurface,
              },
            ]}
          >
            {`${emojiFor(c)} ${c.label}${opt ? ' ?' : ''}`}
          </Chip>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  chip: {
    height: 24,
    paddingHorizontal: 0,
  },
  chipText: {
    fontSize: 11,
    marginVertical: 0,
    marginHorizontal: 0,
    paddingHorizontal: 0,
  },
});
