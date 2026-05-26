/**
 * Ecran de retour apres clic sur le lien de confirmation envoye par email.
 *
 * Le user clique sur le lien depuis sa boite mail ; le deep link
 * `mealendar:///auth/confirm?...` (ou `#...`) ouvre cet ecran.
 *
 * Supabase peut envoyer plusieurs formats selon le flow et le type d'email :
 *
 *  1. PKCE flow (newer) :
 *     mealendar://auth/confirm?code=<oauth_code>
 *     -> exchangeCodeForSession(code)
 *
 *  2. Implicit flow (default email confirm) :
 *     mealendar://auth/confirm#access_token=<jwt>&refresh_token=<rt>&...&type=signup
 *     -> setSession({ access_token, refresh_token })
 *
 *  3. OTP flow (magic link older) :
 *     mealendar://auth/confirm?token_hash=<hash>&type=signup
 *     -> verifyOtp({ token_hash, type })
 *
 *  4. Erreur (lien expire, deja utilise) :
 *     mealendar://auth/confirm?error=...&error_description=...
 *     ou mealendar://auth/confirm#error=...&error_description=...
 *
 * On supporte les 4 cas. Pour les fragments (#...), on parse via
 * Linking.getInitialURL puisque useLocalSearchParams ne les voit pas.
 */
import { supabase } from '@/lib/supabase';
import * as Linking from 'expo-linking';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Parse les params d'un deep link (query + fragment combines).
 *
 * `Linking.parse` retourne :
 *   { hostname, path, queryParams: { ... } }
 *
 * Mais il ne capture PAS le fragment (`#key=value`). On parse manuellement
 * la string apres le `#` si presente.
 */
function parseDeepLinkParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};

  try {
    const parsed = Linking.parse(url);
    if (parsed.queryParams) {
      for (const [k, v] of Object.entries(parsed.queryParams)) {
        if (typeof v === 'string') out[k] = v;
        else if (Array.isArray(v) && typeof v[0] === 'string') out[k] = v[0];
      }
    }
  } catch {
    // ignore parse error, on continue avec le fragment
  }

  // Recherche le fragment (`#...`) et parse en URLSearchParams
  const hashIdx = url.indexOf('#');
  if (hashIdx >= 0) {
    const fragment = url.slice(hashIdx + 1);
    const fragParams = new URLSearchParams(fragment);
    for (const [k, v] of fragParams.entries()) {
      out[k] = v;
    }
  }

  return out;
}

export default function AuthConfirmScreen() {
  const theme = useTheme();
  // useLocalSearchParams ne capte que les query params, pas les fragments.
  // Pour les flows Supabase Implicit (fragment access_token), on retombe
  // sur Linking.getInitialURL.
  const queryParams = useLocalSearchParams<{
    code?: string;
    token_hash?: string;
    type?: string;
    error?: string;
    error_description?: string;
    access_token?: string;
    refresh_token?: string;
  }>();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // Recupere l'URL initiale pour parser le fragment (si present).
      // Sur la 1ere ouverture du deep link, getInitialURL retourne l'URL
      // complete avec query + fragment. queryParams ne capte que les query.
      let allParams: Record<string, string | undefined> = { ...queryParams };
      try {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) {
          const parsed = parseDeepLinkParams(initialUrl);
          allParams = { ...parsed, ...allParams };
        }
      } catch (e) {
        console.warn('[auth/confirm] getInitialURL failed', e);
      }

      console.log('[auth/confirm] resolved params keys:', Object.keys(allParams));

      // Cas 4 : erreur Supabase
      if (allParams.error) {
        if (!cancelled) {
          setErrorMsg(allParams.error_description ?? allParams.error ?? 'Erreur Supabase');
          setStatus('error');
        }
        return;
      }

      try {
        // Cas 1 : PKCE flow
        if (allParams.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(allParams.code);
          if (error) throw error;
        }
        // Cas 2 : Implicit flow (fragment access_token + refresh_token)
        else if (allParams.access_token && allParams.refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token: allParams.access_token,
            refresh_token: allParams.refresh_token,
          });
          if (error) throw error;
        }
        // Cas 3 : OTP flow
        else if (allParams.token_hash && allParams.type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: allParams.token_hash,
            // biome-ignore lint/suspicious/noExplicitAny: type strict supabase
            type: allParams.type as any,
          });
          if (error) throw error;
        } else {
          throw new Error('Lien de confirmation invalide ou incomplet (parametres manquants).');
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
  }, [queryParams]);

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
