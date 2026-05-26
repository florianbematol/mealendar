/**
 * Ecran post-signup quand le compte vient d'etre cree mais que la session
 * n'est pas active (Supabase exige la confirmation de l'email).
 *
 * On y arrive via /verify-email?email=user@example.com.
 *
 * Comportement :
 *  - Affiche un message clair (boite mail a verifier).
 *  - Auto-redirige vers /login apres 6 secondes.
 *  - Bouton "Aller a la connexion" pour rediriger immediatement.
 *  - Bouton "Renvoyer l'email" pour relancer l'envoi du lien.
 */
import { supabase } from '@/lib/supabase';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText, Surface, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

const REDIRECT_DELAY_MS = 6000;

export default function VerifyEmailScreen() {
  const theme = useTheme();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(REDIRECT_DELAY_MS / 1000));
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [resendError, setResendError] = useState<string | null>(null);
  const redirectedRef = useRef(false);

  // Compte a rebours + redirect auto
  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    const timer = setTimeout(() => {
      if (redirectedRef.current) return;
      redirectedRef.current = true;
      router.replace('/(auth)/login');
    }, REDIRECT_DELAY_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, []);

  const goToLogin = () => {
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    router.replace('/(auth)/login');
  };

  const onResend = async () => {
    if (!email) return;
    setResendStatus('sending');
    setResendError(null);
    try {
      const emailRedirectTo = Linking.createURL('/auth/confirm');
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo },
      });
      if (error) throw error;
      setResendStatus('sent');
    } catch (e) {
      setResendStatus('error');
      setResendError(e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <View style={styles.container}>
        <Surface
          elevation={0}
          style={[styles.iconBubble, { backgroundColor: theme.colors.tertiaryContainer }]}
        >
          <Text style={[styles.icon, { color: theme.colors.tertiary }]}>📧</Text>
        </Surface>
        <Text variant="headlineSmall" style={styles.title}>
          Verifiez votre boite mail
        </Text>
        <Text
          variant="bodyMedium"
          style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}
        >
          Un lien de confirmation vient d'etre envoye{email ? ' a ' : '.'}
          {email ? <Text style={styles.email}>{email}</Text> : null}
          {email ? '.' : ''}
        </Text>
        <Text variant="bodySmall" style={[styles.note, { color: theme.colors.onSurfaceVariant }]}>
          Cliquez sur le lien depuis votre messagerie, puis revenez vous connecter.
        </Text>

        <Button
          mode="contained"
          icon="login"
          onPress={goToLogin}
          style={styles.button}
          contentStyle={styles.buttonContent}
        >
          Aller a la connexion
        </Button>

        <Button
          mode="text"
          icon="email-sync-outline"
          onPress={onResend}
          loading={resendStatus === 'sending'}
          disabled={!email || resendStatus === 'sending' || resendStatus === 'sent'}
          style={styles.resendBtn}
        >
          {resendStatus === 'sent' ? 'Email renvoye' : "Renvoyer l'email"}
        </Button>

        {resendError && (
          <HelperText type="error" visible style={styles.helper}>
            {resendError}
          </HelperText>
        )}

        <Text
          variant="labelSmall"
          style={[styles.countdown, { color: theme.colors.onSurfaceVariant }]}
        >
          Redirection automatique dans {secondsLeft} s...
        </Text>
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
    gap: 8,
  },
  iconBubble: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  icon: { fontSize: 44 },
  title: {
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    marginTop: 8,
  },
  email: { fontWeight: '700' },
  note: {
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 8,
  },
  button: {
    marginTop: 32,
    borderRadius: 12,
    minWidth: 240,
  },
  buttonContent: { paddingVertical: 6 },
  resendBtn: { marginTop: 4 },
  helper: { marginTop: 4 },
  countdown: { marginTop: 24 },
});
