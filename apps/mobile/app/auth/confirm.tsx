/**
 * Ecran de retour apres clic sur le lien de confirmation envoye par email.
 *
 * Le user clique sur le lien depuis sa boite mail ; le deep link
 * `mealendar:///auth/confirm?code=...` ouvre cet ecran avec un code OAuth/PKCE.
 * On echange ce code contre une session Supabase, puis on redirige vers /
 * (le RootStack se chargera de router vers (app) ou (auth) selon la session).
 *
 * Cas d'erreur : on affiche le message + bouton retour login.
 */
import { supabase } from '@/lib/supabase';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AuthConfirmScreen() {
  const theme = useTheme();
  // Supabase peut renvoyer plusieurs parametres :
  //  - code (PKCE flow)         -> exchangeCodeForSession
  //  - token_hash + type        -> verifyOtp
  //  - error / error_description (lien expire, etc.)
  const params = useLocalSearchParams<{
    code?: string;
    token_hash?: string;
    type?: string;
    error?: string;
    error_description?: string;
  }>();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // Erreur cote Supabase (ex lien expire) : on affiche l'erreur
      if (params.error) {
        if (!cancelled) {
          setErrorMsg(params.error_description ?? params.error);
          setStatus('error');
        }
        return;
      }

      try {
        if (params.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(params.code);
          if (error) throw error;
        } else if (params.token_hash && params.type) {
          // Magic link / OTP older flow
          const { error } = await supabase.auth.verifyOtp({
            token_hash: params.token_hash,
            // biome-ignore lint/suspicious/noExplicitAny: type stricte impose par supabase mais on recoit un string
            type: params.type as any,
          });
          if (error) throw error;
        } else {
          throw new Error('Lien de confirmation invalide ou incomplet.');
        }

        if (cancelled) return;
        setStatus('success');
        // Petite pause UX pour que l'utilisateur voie le succes, puis redirect.
        setTimeout(() => {
          if (cancelled) return;
          router.replace('/');
        }, 800);
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : 'Erreur inconnue');
        setStatus('error');
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [params.code, params.token_hash, params.type, params.error, params.error_description]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        {status === 'verifying' && (
          <>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text variant="titleMedium" style={styles.text}>
              Confirmation en cours...
            </Text>
          </>
        )}
        {status === 'success' && (
          <>
            <Text style={styles.icon}>✅</Text>
            <Text variant="titleMedium" style={styles.text}>
              Email confirme
            </Text>
            <Text
              variant="bodyMedium"
              style={[styles.subtext, { color: theme.colors.onSurfaceVariant }]}
            >
              Redirection en cours...
            </Text>
          </>
        )}
        {status === 'error' && (
          <>
            <Text style={styles.icon}>⚠️</Text>
            <Text variant="titleMedium" style={styles.text}>
              Echec de la confirmation
            </Text>
            <Text
              variant="bodyMedium"
              style={[styles.subtext, { color: theme.colors.onSurfaceVariant }]}
            >
              {errorMsg ?? 'Le lien est peut-etre expire.'}
            </Text>
            <Button
              mode="contained"
              onPress={() => router.replace('/(auth)/login')}
              style={styles.button}
            >
              Aller a la connexion
            </Button>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  icon: { fontSize: 56 },
  text: { fontWeight: '700', textAlign: 'center' },
  subtext: { textAlign: 'center' },
  button: { marginTop: 16, borderRadius: 12 },
});
