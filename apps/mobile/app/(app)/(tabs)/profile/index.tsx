import { Topbar } from '@/components/Topbar';
import { useAuth } from '@/hooks/useAuth';
import { useMe } from '@/hooks/useMe';
import { unregisterForPushNotifications } from '@/lib/pushNotifications';
import { supabase } from '@/lib/supabase';
import { clearActiveHousehold, useActiveHousehold } from '@/stores/activeHousehold';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, Divider, Surface, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ProfileScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const me = useMe(!!session);
  const activeHouseholdId = useActiveHousehold((s) => s.householdId);
  const setHouseholdId = useActiveHousehold((s) => s.setHouseholdId);

  const onSignOut = async () => {
    Alert.alert('Deconnexion', 'Voulez-vous vous deconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Se deconnecter',
        style: 'destructive',
        onPress: async () => {
          // Desinscrit le push token avant de signOut (sinon on perd l'auth).
          await unregisterForPushNotifications().catch(() => {
            // best-effort
          });
          clearActiveHousehold();
          queryClient.clear();
          await supabase.auth.signOut();
        },
      },
    ]);
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
      edges={['top']}
    >
      <Topbar />
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={me.isFetching && !me.isPending}
            onRefresh={() => me.refetch()}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* User identity */}
        <Surface elevation={0} style={[styles.userCard, { backgroundColor: theme.colors.surface }]}>
          <Surface
            elevation={0}
            style={[styles.avatar, { backgroundColor: theme.colors.primaryContainer }]}
          >
            <Text style={[styles.avatarLetter, { color: theme.colors.primary }]}>
              {(session?.user.email ?? 'M').slice(0, 1).toUpperCase()}
            </Text>
          </Surface>
          <View style={{ flex: 1 }}>
            <Text variant="titleMedium" style={styles.userName}>
              {session?.user.email?.split('@')[0] ?? 'Utilisateur'}
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {session?.user.email ?? ''}
            </Text>
          </View>
        </Surface>

        {/* Foyers */}
        <View style={styles.section}>
          <Text variant="labelLarge" style={styles.sectionTitle}>
            Mes foyers
          </Text>
          {(me.data?.households ?? []).map((h) => {
            const active = h.id === activeHouseholdId;
            return (
              <Surface
                key={h.id}
                elevation={0}
                style={[
                  styles.householdRow,
                  {
                    backgroundColor: active ? theme.colors.primaryContainer : theme.colors.surface,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    variant="titleMedium"
                    style={[
                      styles.householdName,
                      {
                        color: active ? theme.colors.onPrimaryContainer : theme.colors.onSurface,
                      },
                    ]}
                  >
                    {h.name}
                  </Text>
                  <View style={styles.householdMeta}>
                    <Chip
                      compact
                      style={{
                        backgroundColor: active
                          ? theme.colors.surface
                          : theme.colors.surfaceVariant,
                      }}
                      textStyle={styles.metaChipText}
                    >
                      {h.role}
                    </Chip>
                  </View>
                </View>
                {!active && (
                  <Button mode="text" compact onPress={() => setHouseholdId(h.id)}>
                    Activer
                  </Button>
                )}
                <Button
                  mode="text"
                  compact
                  onPress={() => router.push(`/(app)/household/${h.id}`)}
                  icon="chevron-right"
                  contentStyle={{ flexDirection: 'row-reverse' }}
                >
                  Details
                </Button>
              </Surface>
            );
          })}

          <Button
            mode="outlined"
            icon="plus"
            onPress={() => router.push('/(app)/onboarding')}
            style={styles.addBtn}
          >
            Creer ou rejoindre un autre foyer
          </Button>
        </View>

        <Divider style={styles.divider} />

        {/* Profil dietetique */}
        <View style={styles.section}>
          <Text variant="labelLarge" style={styles.sectionTitle}>
            Profil dietetique
          </Text>
          <Surface
            elevation={0}
            style={[styles.linkRow, { backgroundColor: theme.colors.surface }]}
          >
            <View style={{ flex: 1 }}>
              <Text variant="titleSmall" style={{ fontWeight: '700' }}>
                Mon plan alimentaire
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                Regimes, allergies, objectifs et besoins par repas.
              </Text>
            </View>
            <Button
              mode="text"
              compact
              icon="chevron-right"
              contentStyle={{ flexDirection: 'row-reverse' }}
              onPress={() => router.push('/(app)/(tabs)/planning/diet-plan')}
            >
              Editer
            </Button>
          </Surface>
          <Surface
            elevation={0}
            style={[styles.linkRow, { backgroundColor: theme.colors.surface }]}
          >
            <View style={{ flex: 1 }}>
              <Text variant="titleSmall" style={{ fontWeight: '700' }}>
                Plans des autres membres
              </Text>
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                Voir les regimes et besoins des autres membres du foyer.
              </Text>
            </View>
            <Button
              mode="text"
              compact
              icon="chevron-right"
              contentStyle={{ flexDirection: 'row-reverse' }}
              onPress={() => router.push('/(app)/(tabs)/profile/household-diet-plans')}
            >
              Voir
            </Button>
          </Surface>
        </View>

        <Divider style={styles.divider} />

        {/* Compte / preferences */}
        <View style={styles.section}>
          <Text variant="labelLarge" style={styles.sectionTitle}>
            Preferences
          </Text>
          <Surface elevation={0} style={[styles.row, { backgroundColor: theme.colors.surface }]}>
            <Text variant="bodyMedium">Notifications</Text>
            <Chip
              compact
              icon="bell-off-outline"
              style={{ backgroundColor: theme.colors.surfaceVariant }}
            >
              Bientot
            </Chip>
          </Surface>
          <Surface elevation={0} style={[styles.row, { backgroundColor: theme.colors.surface }]}>
            <Text variant="bodyMedium">Profil dietetique</Text>
            <Chip compact icon="leaf" style={{ backgroundColor: theme.colors.surfaceVariant }}>
              Bientot
            </Chip>
          </Surface>
        </View>

        <Button
          mode="outlined"
          onPress={onSignOut}
          icon="logout"
          textColor={theme.colors.error}
          style={[styles.signOut, { borderColor: theme.colors.outline }]}
        >
          Se deconnecter
        </Button>

        <Text
          variant="bodySmall"
          style={[styles.version, { color: theme.colors.onSurfaceVariant }]}
        >
          Mealendar v0.1.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    padding: 16,
    gap: 20,
    paddingBottom: 32,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontSize: 22,
    fontWeight: '800',
  },
  userName: { fontWeight: '700' },
  section: { gap: 8 },
  sectionTitle: {
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  householdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    gap: 8,
  },
  householdName: { fontWeight: '700' },
  householdMeta: { flexDirection: 'row', marginTop: 6, gap: 6 },
  metaChipText: { fontSize: 11 },
  addBtn: { marginTop: 4, borderRadius: 12 },
  divider: { marginVertical: 4 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
  },
  signOut: { borderRadius: 12, marginTop: 8 },
  version: { textAlign: 'center', marginTop: 16 },
});
