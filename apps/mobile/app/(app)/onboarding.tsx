import { useAuth } from '@/hooks/useAuth';
import { ApiError, createHousehold, fetchWhoami, joinHousehold } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useActiveHousehold } from '@/stores/activeHousehold';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Button,
  Divider,
  HelperText,
  SegmentedButtons,
  Surface,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

type Mode = 'create' | 'join';

export default function OnboardingScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const setHouseholdId = useActiveHousehold((s) => s.setHouseholdId);

  const [mode, setMode] = useState<Mode>('create');
  const [householdName, setHouseholdName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<string | null>(null);

  const onSubmit = async () => {
    if (submitting) return; // anti double-clic en plus du disabled
    Keyboard.dismiss();
    setError(null);
    setSubmitting(true);
    try {
      const summary =
        mode === 'create'
          ? await createHousehold({
              name: householdName.trim(),
              displayName: displayName.trim() || undefined,
            })
          : await joinHousehold({
              inviteCode: inviteCode.trim().toUpperCase(),
              displayName: displayName.trim() || undefined,
            });

      setHouseholdId(summary.id);
      // refetchQueries (et non invalidateQueries) garantit que /api/me est a jour
      // AVANT que le layout (app) re-render. Lorsque households.length > 0,
      // (app)/_layout.tsx bascule automatiquement vers (tabs) - pas besoin de
      // router.replace manuel qui creait un blocage en cas de race.
      await queryClient.refetchQueries({ queryKey: ['me'] });
    } catch (e) {
      if (e instanceof ApiError) {
        setError(`${e.status} - ${e.message}`);
      } else {
        setError(e instanceof Error ? e.message : 'Erreur inconnue');
      }
    } finally {
      // Toujours remettre submitting=false : si la creation reussit, le layout
      // demonte ce composant juste apres ; si elle echoue, le user peut reessayer.
      setSubmitting(false);
    }
  };

  const onSignOut = async () => {
    await supabase.auth.signOut();
  };

  const canSubmit =
    !submitting &&
    ((mode === 'create' && householdName.trim().length > 0) ||
      (mode === 'join' && inviteCode.trim().length >= 6));

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kav}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Surface
              elevation={0}
              style={[styles.logoBubble, { backgroundColor: theme.colors.tertiaryContainer }]}
            >
              <Text style={[styles.logoEmoji, { color: theme.colors.tertiary }]}>🏠</Text>
            </Surface>
            <Text variant="headlineMedium" style={styles.title}>
              Votre foyer
            </Text>
            <Text
              variant="bodyMedium"
              style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}
            >
              Creez le votre, ou rejoignez celui d'un proche pour partager vos plannings.
            </Text>
            {session?.user.email && (
              <View style={[styles.userChip, { backgroundColor: theme.colors.surfaceVariant }]}>
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  Connecte : {session.user.email}
                </Text>
              </View>
            )}
          </View>

          <SegmentedButtons
            value={mode}
            onValueChange={(v) => {
              setMode(v as Mode);
              setError(null);
            }}
            buttons={[
              { value: 'create', label: 'Creer', icon: 'plus' },
              { value: 'join', label: 'Rejoindre', icon: 'account-multiple-plus' },
            ]}
            style={styles.segmented}
          />

          <Surface elevation={0} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
            {mode === 'create' ? (
              <TextInput
                label="Nom du foyer"
                value={householdName}
                onChangeText={setHouseholdName}
                mode="outlined"
                placeholder="Ex : Famille Dupont"
                style={styles.input}
                autoCapitalize="words"
                maxLength={100}
                left={<TextInput.Icon icon="home-outline" />}
              />
            ) : (
              <TextInput
                label="Code d'invitation"
                value={inviteCode}
                onChangeText={(v) => setInviteCode(v.toUpperCase())}
                mode="outlined"
                placeholder="Ex : ABC23DEF"
                autoCapitalize="characters"
                autoCorrect={false}
                style={styles.input}
                maxLength={16}
                left={<TextInput.Icon icon="key-outline" />}
              />
            )}

            <TextInput
              label="Votre nom dans le foyer (optionnel)"
              value={displayName}
              onChangeText={setDisplayName}
              mode="outlined"
              placeholder="Ex : Papa, Maman, Alice..."
              style={styles.input}
              maxLength={100}
              left={<TextInput.Icon icon="account-outline" />}
            />

            {error && (
              <HelperText type="error" visible style={styles.helper}>
                {error}
              </HelperText>
            )}

            <Button
              mode="contained"
              onPress={onSubmit}
              loading={submitting}
              disabled={!canSubmit}
              style={styles.button}
              contentStyle={styles.buttonContent}
              icon={mode === 'create' ? 'plus-circle-outline' : 'account-multiple-plus'}
            >
              {mode === 'create' ? 'Creer mon foyer' : 'Rejoindre le foyer'}
            </Button>
          </Surface>

          <Divider style={styles.divider} />

          <View style={styles.actionsBottom}>
            <Button
              mode="text"
              compact
              onPress={async () => {
                try {
                  const result = await fetchWhoami();
                  setDebug(JSON.stringify(result, null, 2));
                } catch (e) {
                  setDebug(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
            >
              Debug : Whoami
            </Button>
            <Button mode="text" compact onPress={onSignOut} textColor={theme.colors.error}>
              Se deconnecter
            </Button>
          </View>

          {debug && (
            <Surface
              elevation={0}
              style={[styles.debugBlock, { backgroundColor: theme.colors.surfaceVariant }]}
            >
              <Text selectable style={styles.debugText}>
                {debug}
              </Text>
            </Surface>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  kav: { flex: 1 },
  container: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoBubble: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoEmoji: {
    fontSize: 32,
  },
  title: {
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 8,
  },
  userChip: {
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  segmented: {
    marginBottom: 16,
  },
  card: {
    padding: 20,
    borderRadius: 16,
    gap: 4,
  },
  input: {
    marginBottom: 8,
  },
  helper: {
    marginBottom: 4,
  },
  button: {
    marginTop: 12,
    borderRadius: 12,
  },
  buttonContent: {
    paddingVertical: 6,
  },
  divider: {
    marginVertical: 24,
  },
  actionsBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  debugBlock: {
    padding: 12,
    borderRadius: 12,
    marginTop: 16,
  },
  debugText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
  },
});
