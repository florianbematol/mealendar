import { useAuth } from '@/hooks/useAuth';
import { useMe } from '@/hooks/useMe';
import { lightTheme } from '@/lib/theme';
import { useActiveHousehold } from '@/stores/activeHousehold';
import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text, useTheme } from 'react-native-paper';

/**
 * Layout du group (app) : protege toutes les routes authentifiees.
 *
 * Flow :
 *   - pas de session       -> redirige vers /(auth)/login
 *   - session sans foyer   -> redirige vers /onboarding
 *   - session avec foyers  -> rend le Stack normal (qui contient (tabs))
 */
export default function AppLayout() {
  const theme = useTheme();
  const { session, loading: authLoading } = useAuth();
  const me = useMe(!!session);
  const activeHouseholdId = useActiveHousehold((s) => s.householdId);
  const setHouseholdId = useActiveHousehold((s) => s.setHouseholdId);

  // Aligne l'active household si invalide
  useEffect(() => {
    if (!me.data) return;
    const households = me.data.households;
    if (households.length === 0) return;
    if (!activeHouseholdId || !households.some((h) => h.id === activeHouseholdId)) {
      const first = households[0];
      if (first) setHouseholdId(first.id);
    }
  }, [me.data, activeHouseholdId, setHouseholdId]);

  if (authLoading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!session) return <Redirect href="/(auth)/login" />;

  if (me.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text variant="bodyMedium" style={[styles.text, { color: theme.colors.onSurfaceVariant }]}>
          Chargement de votre profil...
        </Text>
      </View>
    );
  }

  if (me.isError) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <Text variant="titleMedium">Erreur de connexion au backend</Text>
        <Text variant="bodyMedium" style={[styles.text, { color: theme.colors.onSurfaceVariant }]}>
          {(me.error as Error).message}
        </Text>
      </View>
    );
  }

  const households = me.data?.households ?? [];
  if (households.length === 0) {
    // L'onboarding est dans le meme group, donc accessible.
    // On force la redirection pour que l'utilisateur ne puisse pas voir les tabs vides.
    return (
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: lightTheme.colors.background },
        }}
      >
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" redirect />
      </Stack>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: lightTheme.colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="onboarding"
        options={{
          presentation: 'modal',
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="household/[id]"
        options={{
          headerShown: true,
          title: 'Foyer',
          headerStyle: { backgroundColor: lightTheme.colors.background },
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '700' },
        }}
      />
    </Stack>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  text: {
    marginTop: 12,
    textAlign: 'center',
  },
});
