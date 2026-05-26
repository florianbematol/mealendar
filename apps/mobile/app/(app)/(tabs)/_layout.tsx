import { lightTheme } from '@/lib/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs, router } from 'expo-router';
import { useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // Sur Android avec gesture nav, insets.bottom peut etre 0 mais la barre
  // systeme prend ~16-24px. On garde un padding mini pour eviter que les
  // labels soient coles au bord.
  const bottomPadding = Math.max(insets.bottom, 8);
  const tabBarHeight = 56 + bottomPadding;

  /**
   * Quand on tape sur un onglet qui contient une Stack (sous-routes),
   * on veut systematiquement revenir a l'index de cet onglet plutot que
   * de rester sur la sous-route ouverte precedemment.
   *
   * On intercepte `tabPress`, on previent le comportement par defaut, et
   * on fait router.replace vers l'index. Si l'onglet est deja focused, on
   * pop aussi pour ramener a l'index.
   */
  const resetToIndex = (path: string) => ({
    tabPress: (e: { preventDefault: () => void }) => {
      e.preventDefault();
      router.replace(path);
    },
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarStyle: {
          backgroundColor: lightTheme.colors.surface,
          borderTopColor: lightTheme.colors.outlineVariant,
          height: tabBarHeight,
          paddingBottom: bottomPadding,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="home-variant" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="recipes"
        options={{
          title: 'Recettes',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="book-open-variant" size={size} color={color} />
          ),
        }}
        listeners={resetToIndex('/(app)/(tabs)/recipes')}
      />
      <Tabs.Screen
        name="planning"
        options={{
          title: 'Planning',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="calendar-month" size={size} color={color} />
          ),
        }}
        listeners={resetToIndex('/(app)/(tabs)/planning')}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'account-circle' : 'account-circle-outline'}
              size={size}
              color={color}
            />
          ),
        }}
        listeners={resetToIndex('/(app)/(tabs)/profile')}
      />
    </Tabs>
  );
}
