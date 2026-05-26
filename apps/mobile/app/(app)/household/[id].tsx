import { useAuth } from '@/hooks/useAuth';
import {
  useDeleteHousehold,
  useHouseholdDetail,
  useLeaveHousehold,
  useRegenerateInviteCode,
} from '@/hooks/useHouseholds';
import { useMe } from '@/hooks/useMe';
import { ApiError } from '@/lib/api';
import { useActiveHousehold } from '@/stores/activeHousehold';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  Dialog,
  Divider,
  HelperText,
  Portal,
  Surface,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HouseholdDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const me = useMe();
  const detail = useHouseholdDetail(id);
  const regen = useRegenerateInviteCode();
  const leave = useLeaveHousehold();
  const delMut = useDeleteHousehold();
  const setActive = useActiveHousehold((s) => s.setHouseholdId);

  const myMembership = me.data?.households.find((h) => h.id === id);
  const isAdmin = myMembership?.role === 'owner' || myMembership?.role === 'admin';
  const isOwner = myMembership?.role === 'owner';

  // Modal de confirmation de suppression : on demande de retaper le nom du foyer
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (detail.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <Text variant="titleMedium">Foyer introuvable</Text>
        <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
          {detail.error instanceof ApiError ? detail.error.message : 'Erreur'}
        </Text>
      </View>
    );
  }
  const h = detail.data;

  const onShareInvite = async () => {
    if (!h.inviteCode) return;
    try {
      await Share.share({
        title: `Rejoindre ${h.name} sur Mealendar`,
        message: `Rejoins-moi sur Mealendar pour partager nos repas !\n\nCode du foyer "${h.name}" : ${h.inviteCode}`,
      });
    } catch {
      // share annule
    }
  };

  const onRegen = () => {
    Alert.alert('Regenerer le code', "L'ancien code ne fonctionnera plus. Continuer ?", [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Regenerer',
        onPress: async () => {
          try {
            await regen.mutateAsync({ id: h.id });
          } catch (e) {
            Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
          }
        },
      },
    ]);
  };

  const onLeave = () => {
    Alert.alert('Quitter le foyer', `Quitter "${h.name}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Quitter',
        style: 'destructive',
        onPress: async () => {
          try {
            await leave.mutateAsync({ id: h.id });
            setActive(null);
            router.replace('/(app)/(tabs)/profile');
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Erreur inconnue';
            Alert.alert('Impossible', msg);
          }
        },
      },
    ]);
  };

  const onConfirmDelete = async () => {
    setDeleteError(null);
    if (confirmName.trim() !== h.name) {
      setDeleteError(`Tape exactement le nom du foyer (${h.name}) pour confirmer.`);
      return;
    }
    try {
      await delMut.mutateAsync({ id: h.id });
      setDeleteOpen(false);
      setConfirmName('');
      setActive(null);
      router.replace('/(app)/(tabs)/profile');
    } catch (e) {
      if (e instanceof ApiError) setDeleteError(`${e.status} - ${e.message}`);
      else setDeleteError(e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
      edges={['bottom']}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <Surface
          elevation={0}
          style={[styles.heroCard, { backgroundColor: theme.colors.primaryContainer }]}
        >
          <Text style={styles.heroEmoji}>🏠</Text>
          <Text
            variant="headlineSmall"
            style={[styles.heroName, { color: theme.colors.onPrimaryContainer }]}
          >
            {h.name}
          </Text>
          <Text
            variant="bodySmall"
            style={{ color: theme.colors.onPrimaryContainer, marginTop: 4 }}
          >
            {h.members.length} membre{h.members.length > 1 ? 's' : ''}
          </Text>
        </Surface>

        {/* Code d'invitation */}
        <Surface elevation={0} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Text variant="labelLarge" style={styles.cardLabel}>
            Code d'invitation
          </Text>
          {h.inviteCode ? (
            <View style={styles.inviteRow}>
              <Text
                variant="headlineSmall"
                selectable
                style={[styles.inviteCode, { color: theme.colors.primary }]}
              >
                {h.inviteCode}
              </Text>
              <Button mode="contained-tonal" icon="share-variant" onPress={onShareInvite} compact>
                Partager
              </Button>
            </View>
          ) : (
            <Text style={{ color: theme.colors.onSurfaceVariant }}>Aucun code defini.</Text>
          )}
          {isAdmin && (
            <Button
              mode="text"
              icon="refresh"
              onPress={onRegen}
              loading={regen.isPending}
              compact
              style={{ alignSelf: 'flex-start' }}
            >
              Regenerer
            </Button>
          )}
        </Surface>

        {/* Membres */}
        <Surface elevation={0} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
          <Text variant="labelLarge" style={styles.cardLabel}>
            Membres ({h.members.length})
          </Text>
          {h.members.map((m) => {
            const isMe = m.userId === session?.user.id;
            return (
              <View key={m.userId} style={styles.memberRow}>
                <Surface
                  elevation={0}
                  style={[styles.memberAvatar, { backgroundColor: theme.colors.primary }]}
                >
                  <Text style={[styles.memberAvatarLetter, { color: theme.colors.onPrimary }]}>
                    {(m.displayName ?? m.email ?? '?').slice(0, 1).toUpperCase()}
                  </Text>
                </Surface>
                <View style={{ flex: 1 }}>
                  <Text variant="titleSmall" style={styles.memberName}>
                    {m.displayName ?? m.email?.split('@')[0] ?? 'Membre'}
                    {isMe && (
                      <Text style={{ color: theme.colors.onSurfaceVariant, fontWeight: '400' }}>
                        {' (vous)'}
                      </Text>
                    )}
                  </Text>
                  {m.email && (
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      {m.email}
                    </Text>
                  )}
                </View>
                <Chip
                  compact
                  style={{
                    backgroundColor:
                      m.role === 'owner'
                        ? theme.colors.tertiaryContainer
                        : theme.colors.surfaceVariant,
                  }}
                  textStyle={{ fontSize: 11 }}
                >
                  {m.role}
                </Chip>
              </View>
            );
          })}
        </Surface>

        <Divider style={styles.divider} />

        <Button
          mode="outlined"
          icon="exit-to-app"
          onPress={onLeave}
          textColor={theme.colors.error}
          style={[styles.leaveBtn, { borderColor: theme.colors.outline }]}
        >
          Quitter ce foyer
        </Button>

        {isOwner && (
          <Button
            mode="contained"
            icon="trash-can-outline"
            onPress={() => {
              setConfirmName('');
              setDeleteError(null);
              setDeleteOpen(true);
            }}
            buttonColor={theme.colors.error}
            textColor={theme.colors.onError}
            style={styles.deleteBtn}
          >
            Supprimer le foyer
          </Button>
        )}
      </ScrollView>

      <Portal>
        <Dialog
          visible={deleteOpen}
          onDismiss={() => {
            if (!delMut.isPending) {
              setDeleteOpen(false);
              setConfirmName('');
              setDeleteError(null);
            }
          }}
          style={{ backgroundColor: theme.colors.background, borderRadius: 16 }}
        >
          <Dialog.Title style={{ fontWeight: '700' }}>Supprimer "{h.name}" ?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
              Cette action est <Text style={{ fontWeight: '700' }}>irreversible</Text>. Tout sera
              perdu :
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              • Recettes du foyer{'\n'}• Plannings et liste de courses{'\n'}• Plan-type et plan
              alimentaire{'\n'}• Tous les autres membres seront retires
            </Text>
            <Text variant="bodyMedium" style={{ marginTop: 12 }}>
              Tape le nom du foyer pour confirmer :
            </Text>
            <TextInput
              mode="outlined"
              label={h.name}
              value={confirmName}
              onChangeText={setConfirmName}
              autoCapitalize="none"
              autoCorrect={false}
              dense
              style={{ marginTop: 8 }}
              disabled={delMut.isPending}
            />
            {deleteError && (
              <HelperText type="error" visible style={{ marginTop: 4 }}>
                {deleteError}
              </HelperText>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setDeleteOpen(false);
                setConfirmName('');
                setDeleteError(null);
              }}
              disabled={delMut.isPending}
            >
              Annuler
            </Button>
            <Button
              mode="contained"
              buttonColor={theme.colors.error}
              textColor={theme.colors.onError}
              onPress={onConfirmDelete}
              loading={delMut.isPending}
              disabled={delMut.isPending || confirmName.trim() !== h.name}
              icon="trash-can-outline"
            >
              Supprimer
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { padding: 16, gap: 14, paddingBottom: 32 },

  heroCard: {
    padding: 20,
    borderRadius: 18,
    alignItems: 'center',
  },
  heroEmoji: { fontSize: 40, marginBottom: 4 },
  heroName: { fontWeight: '700' },

  card: { padding: 16, borderRadius: 14, gap: 8 },
  cardLabel: { fontWeight: '700', letterSpacing: 0.3 },
  inviteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  inviteCode: { fontFamily: 'monospace', fontWeight: '800', letterSpacing: 2 },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarLetter: { fontWeight: '800', fontSize: 14 },
  memberName: { fontWeight: '700' },

  divider: { marginVertical: 4 },
  leaveBtn: { borderRadius: 12 },
  deleteBtn: { borderRadius: 12, marginTop: 8 },
});
