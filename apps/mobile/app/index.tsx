import { useAuth } from '@/hooks/useAuth';
import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, useTheme } from 'react-native-paper';

/**
 * Point d'entree de l'app. Redirige selon l'etat d'auth.
 *
 * Note : cette route `/` est en conflit avec `(app)/(tabs)/index.tsx` qui sert
 * la home authentifiee. Pour eviter le conflit, on redirige systematiquement
 * vers `/(app)` ou `/(auth)/login` ; le sous-layout (app) s'occupe ensuite de
 * router vers /onboarding ou /(tabs) selon la presence d'un foyer.
 */
export default function Index() {
  const theme = useTheme();
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return session ? <Redirect href="/(app)/(tabs)" /> : <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
