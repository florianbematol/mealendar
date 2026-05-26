import { lightTheme } from '@/lib/theme';
import { Stack } from 'expo-router';

/**
 * Routes publiques de retour de deep link (depuis email Supabase).
 * Pas de redirection auth ici : ces ecrans doivent etre accessibles meme
 * sans session, puisque c'est leur role d'en creer une.
 */
export default function AuthDeepLinkLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: lightTheme.colors.background },
      }}
    />
  );
}
