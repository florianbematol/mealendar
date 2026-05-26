/**
 * Helpers haptics centralisés. Utilise expo-haptics côté natif uniquement
 * (web : no-op silencieux). Tous les helpers sont fire-and-forget : on ne
 * bloque jamais le UI thread, on capture les erreurs eventuelles.
 *
 * Convention :
 *  - light    : feedback subtil (toggle d'un chip, scroll snap)
 *  - medium   : action confirmee (favori, lock meal)
 *  - heavy    : action importante (save, generation IA)
 *  - success  : action reussie (recette creee, planning genere)
 *  - warning  : action a confirmer (suppression a venir)
 *  - error    : erreur survenue (echec API)
 *  - selection: selection d'un item dans une liste
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

function safeFire(fn: () => Promise<void>) {
  if (Platform.OS === 'web') return;
  // Fire and forget : on ne veut pas crasher l'UI sur un device sans haptics
  void fn().catch(() => undefined);
}

export const haptics = {
  light: () => safeFire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => safeFire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  heavy: () => safeFire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  success: () =>
    safeFire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () =>
    safeFire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safeFire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  selection: () => safeFire(() => Haptics.selectionAsync()),
};
