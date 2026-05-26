import { HouseholdSwitcher } from '@/components/HouseholdSwitcher';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Topbar partagee pour les ecrans de tabs. Affiche le HouseholdSwitcher a
 * gauche et un slot d'actions a droite (icones, search, etc.).
 *
 * Utilise dans un SafeAreaView avec edges={['top']} dans l'ecran parent.
 */
export function Topbar({ right }: { right?: ReactNode }) {
  return (
    <View style={styles.container}>
      <HouseholdSwitcher />
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    // Hauteur fixe pour eviter que le pill HouseholdSwitcher bouge entre
    // les ecrans selon que `right` contienne un IconButton (~48px avec ses
    // paddings internes RN Paper) ou rien.
    minHeight: 60,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    // On reserve la meme hauteur qu'un IconButton 22 size pour que le
    // container ait toujours la meme hauteur, qu'il y ait des actions ou non.
    minHeight: 48,
  },
});
