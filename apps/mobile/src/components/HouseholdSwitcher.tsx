import { useMe } from '@/hooks/useMe';
import { useActiveHousehold } from '@/stores/activeHousehold';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Divider, Menu, Surface, Text, TouchableRipple, useTheme } from 'react-native-paper';

/**
 * Pill discret affichant le foyer actif. Clic -> menu dropdown :
 *  - liste des foyers (le foyer actif est marque)
 *  - "Creer / rejoindre un foyer" pour aller a l'onboarding
 *  - "Gerer les foyers" pour aller au profil
 */
export function HouseholdSwitcher() {
  const theme = useTheme();
  const me = useMe();
  const activeHouseholdId = useActiveHousehold((s) => s.householdId);
  const setHouseholdId = useActiveHousehold((s) => s.setHouseholdId);
  const [open, setOpen] = useState(false);

  const active = useMemo(
    () => me.data?.households.find((h) => h.id === activeHouseholdId) ?? null,
    [me.data, activeHouseholdId],
  );

  const households = me.data?.households ?? [];
  const initial = (active?.name ?? '?').slice(0, 1).toUpperCase();

  return (
    <Menu
      visible={open}
      onDismiss={() => setOpen(false)}
      anchorPosition="bottom"
      contentStyle={[styles.menuContent, { backgroundColor: theme.colors.surface }]}
      anchor={
        <TouchableRipple
          onPress={() => setOpen(true)}
          borderless
          style={[styles.pill, { backgroundColor: theme.colors.surface }]}
        >
          <View style={styles.pillInner}>
            <Surface
              elevation={0}
              style={[styles.avatar, { backgroundColor: theme.colors.primary }]}
            >
              <Text style={[styles.avatarText, { color: theme.colors.onPrimary }]}>{initial}</Text>
            </Surface>
            <Text
              variant="titleSmall"
              numberOfLines={1}
              style={[styles.pillName, { color: theme.colors.onSurface }]}
            >
              {active?.name ?? 'Aucun foyer'}
            </Text>
            <Text style={[styles.caret, { color: theme.colors.onSurfaceVariant }]}>▾</Text>
          </View>
        </TouchableRipple>
      }
    >
      {households.length > 0 && (
        <>
          {households.map((h) => {
            const isActive = h.id === activeHouseholdId;
            return (
              <Menu.Item
                key={h.id}
                onPress={() => {
                  setHouseholdId(h.id);
                  setOpen(false);
                }}
                leadingIcon={isActive ? 'check' : 'home-outline'}
                title={h.name}
                titleStyle={{
                  fontWeight: isActive ? '700' : '500',
                  color: isActive ? theme.colors.primary : theme.colors.onSurface,
                }}
              />
            );
          })}
          <Divider />
        </>
      )}
      <Menu.Item
        onPress={() => {
          setOpen(false);
          router.push('/(app)/onboarding');
        }}
        leadingIcon="plus"
        title="Creer / rejoindre un foyer"
      />
      <Menu.Item
        onPress={() => {
          setOpen(false);
          router.push('/(app)/(tabs)/profile');
        }}
        leadingIcon="cog-outline"
        title="Gerer mon profil"
      />
    </Menu>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 12,
    alignSelf: 'flex-start',
    maxWidth: 240,
    // Ombre tres legere
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  pillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '800',
  },
  pillName: {
    fontWeight: '700',
    flexShrink: 1,
  },
  caret: {
    fontSize: 14,
    marginLeft: 2,
  },
  menuContent: {
    borderRadius: 12,
    marginTop: 4,
  },
});
