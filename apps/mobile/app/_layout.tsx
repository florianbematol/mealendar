import { ConfigErrorScreen } from '@/components/ConfigErrorScreen';
import { ToastHost } from '@/components/ToastHost';
import { useAuth } from '@/hooks/useAuth';
import {
  configureNotificationHandler,
  registerForPushNotifications,
} from '@/lib/pushNotifications';
import { queryClient } from '@/lib/queryClient';
import { isSupabaseConfigured } from '@/lib/supabase';
import { lightTheme } from '@/lib/theme';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Configure le handler des notifs en foreground (1 fois au load du module).
configureNotificationHandler();

/**
 * Le root layout est minimaliste :
 *  - PaperProvider avec le theme light Mealendar
 *  - QueryClient
 *  - SafeAreaProvider
 *  - Stack racine sans header (les sub-layouts ont chacun leur Stack)
 *
 * Si Supabase n'est pas configure, on affiche ConfigErrorScreen.
 */
function RootStack() {
  const { session, loading } = useAuth();
  // On track le user_id deja enregistre pour ne pas re-faire l'appel a chaque
  // changement de session (refresh, etc.).
  const registeredUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!session?.user.id) {
      registeredUserId.current = null;
      return;
    }
    if (registeredUserId.current === session.user.id) return;
    registeredUserId.current = session.user.id;
    // Enregistre le token Expo pour les push notifs (best-effort).
    void registerForPushNotifications();
  }, [session?.user.id]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: lightTheme.colors.background,
        }}
      >
        <ActivityIndicator size="large" color={lightTheme.colors.primary} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: lightTheme.colors.background },
      }}
    />
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={lightTheme}>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          {isSupabaseConfigured ? <RootStack /> : <ConfigErrorScreen />}
          <ToastHost />
        </QueryClientProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
