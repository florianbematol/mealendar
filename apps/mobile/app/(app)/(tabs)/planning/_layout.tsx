import { lightTheme } from '@/lib/theme';
import { Stack } from 'expo-router';

export default function PlanningLayout() {
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
      <Stack.Screen name="meal-plan" options={{ title: 'Plan-type' }} />
      <Stack.Screen name="diet-plan" options={{ title: 'Plan alimentaire' }} />
      <Stack.Screen name="day/[date]" options={{ title: 'Jour' }} />
      <Stack.Screen name="shopping" options={{ title: 'Liste de courses' }} />
    </Stack>
  );
}
