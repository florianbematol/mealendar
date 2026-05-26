import { lightTheme } from '@/lib/theme';
import { Stack } from 'expo-router';

export default function RecipesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: lightTheme.colors.background },
        headerTintColor: lightTheme.colors.onBackground,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: lightTheme.colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="new" options={{ title: 'Nouvelle recette' }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
    </Stack>
  );
}
