import { supabase } from '@/lib/supabase';
import * as Linking from 'expo-linking';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Button, HelperText, Surface, Text, TextInput, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SignupScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    Keyboard.dismiss();
    setError(null);
    setSubmitting(true);
    try {
      const cleanEmail = email.trim();
      // URL deep link vers laquelle Supabase redirigera depuis l'email de
      // confirmation. Doit etre dans la allowlist Auth > URL Configuration
      // du dashboard Supabase. En dev on utilise l'URL Expo (exp://...) ;
      // en prod / build EAS on utilise mealendar://confirm.
      const emailRedirectTo = Linking.createURL('/auth/confirm');
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { emailRedirectTo },
      });
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      if (data.session) {
        // Compte cree ET email auto-confirme (cas dev sans email confirmation)
        router.replace('/(app)/(tabs)');
      } else {
        // Compte cree, email a confirmer -> ecran dedie
        router.replace({
          pathname: '/(auth)/verify-email',
          params: { email: cleanEmail },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = email.length > 0 && password.length >= 6 && !submitting;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kav}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Surface
              elevation={0}
              style={[styles.logoBubble, { backgroundColor: theme.colors.secondaryContainer }]}
            >
              <Text style={[styles.logoEmoji, { color: theme.colors.secondary }]}>M</Text>
            </Surface>
            <Text variant="displaySmall" style={styles.title}>
              Bienvenue
            </Text>
            <Text
              variant="bodyMedium"
              style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}
            >
              Creez votre compte pour commencer.
            </Text>
          </View>

          <View style={styles.form}>
            <TextInput
              label="Email"
              value={email}
              onChangeText={setEmail}
              mode="outlined"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              left={<TextInput.Icon icon="email-outline" />}
              style={styles.input}
            />
            <TextInput
              label="Mot de passe (6 caracteres min)"
              value={password}
              onChangeText={setPassword}
              mode="outlined"
              secureTextEntry={!showPassword}
              autoComplete="password-new"
              textContentType="newPassword"
              left={<TextInput.Icon icon="lock-outline" />}
              right={
                <TextInput.Icon
                  icon={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  onPress={() => setShowPassword((v) => !v)}
                />
              }
              style={styles.input}
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
            >
              Creer le compte
            </Button>
          </View>

          <View style={styles.footer}>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              Deja un compte ?
            </Text>
            <Link href="/login" replace asChild>
              <Button mode="text" compact>
                Se connecter
              </Button>
            </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  kav: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingTop: 40,
    paddingBottom: 24,
  },
  header: {
    alignItems: 'center',
    marginTop: 24,
  },
  logoBubble: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  logoEmoji: {
    fontSize: 36,
    fontWeight: '800',
  },
  title: {
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  subtitle: {
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  form: {
    gap: 4,
  },
  input: {
    marginBottom: 8,
  },
  helper: {
    marginBottom: 4,
  },
  button: {
    marginTop: 16,
    borderRadius: 12,
  },
  buttonContent: {
    paddingVertical: 6,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
});
