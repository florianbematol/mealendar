import { StyleSheet, View } from 'react-native';
import { Surface, Text, useTheme } from 'react-native-paper';

export function ConfigErrorScreen() {
  const theme = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Surface elevation={0} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
        <Text style={styles.emoji}>🔧</Text>
        <Text variant="titleMedium" style={styles.title}>
          Configuration manquante
        </Text>
        <Text variant="bodyMedium" style={[styles.body, { color: theme.colors.onSurfaceVariant }]}>
          Les variables Supabase ne sont pas definies.
        </Text>
        <Text variant="bodyMedium" style={[styles.body, { color: theme.colors.onSurfaceVariant }]}>
          Creer le fichier <Text style={styles.code}>apps/mobile/.env.local</Text> avec :
        </Text>
        <Surface
          elevation={0}
          style={[styles.codeBlock, { backgroundColor: theme.colors.surfaceVariant }]}
        >
          <Text style={styles.code}>EXPO_PUBLIC_SUPABASE_URL=https://...supabase.co</Text>
          <Text style={styles.code}>EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...</Text>
        </Surface>
        <Text variant="bodyMedium" style={[styles.body, { color: theme.colors.onSurfaceVariant }]}>
          Puis redemarrer Metro avec <Text style={styles.code}>r</Text> ou relancer{' '}
          <Text style={styles.code}>pnpm dev:mobile</Text>.
        </Text>
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  card: {
    padding: 24,
    borderRadius: 16,
  },
  emoji: {
    fontSize: 32,
    marginBottom: 8,
  },
  title: {
    fontWeight: '700',
    marginBottom: 12,
  },
  body: { marginBottom: 12 },
  code: { fontFamily: 'monospace', fontSize: 13 },
  codeBlock: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
});
