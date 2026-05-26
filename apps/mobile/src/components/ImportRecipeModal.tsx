import { useImportRecipeFromUrl } from '@/hooks/useRecipes';
import { ApiError } from '@/lib/api';
import { useActiveHousehold } from '@/stores/activeHousehold';
import { useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  HelperText,
  Portal,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';

export type ImportRecipeModalProps = {
  visible: boolean;
  onDismiss: () => void;
  onSuccess: (recipeId: string) => void;
};

export function ImportRecipeModal({ visible, onDismiss, onSuccess }: ImportRecipeModalProps) {
  const theme = useTheme();
  const householdId = useActiveHousehold((s) => s.householdId);
  const importMut = useImportRecipeFromUrl();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setUrl('');
    setError(null);
    onDismiss();
  };

  const onSubmit = async () => {
    if (!householdId) return;
    Keyboard.dismiss();
    setError(null);
    try {
      const res = await importMut.mutateAsync({
        householdId,
        url: url.trim(),
        save: true,
      });
      if (res.recipeId) {
        onSuccess(res.recipeId);
      } else {
        setError('La recette a ete importee mais pas sauvegardee.');
      }
    } catch (e) {
      if (e instanceof ApiError) setError(`${e.status} - ${e.message}`);
      else setError(e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  return (
    <Portal>
      <Dialog
        visible={visible}
        onDismiss={close}
        style={[styles.dialog, { backgroundColor: theme.colors.background }]}
      >
        <Dialog.Title style={styles.title}>📥 Importer depuis une URL</Dialog.Title>

        <Dialog.Content>
          <Text
            variant="bodySmall"
            style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}
          >
            Colle l'URL d'une recette (Marmiton, 750g, AllRecipes...). On extrait automatiquement
            les ingredients et les etapes.
          </Text>
          <TextInput
            mode="outlined"
            label="URL de la recette"
            value={url}
            onChangeText={setUrl}
            placeholder="https://www.marmiton.org/..."
            autoCapitalize="none"
            keyboardType="url"
            autoComplete="url"
            dense
            multiline
          />
          {error && (
            <HelperText type="error" visible style={{ marginTop: 4 }}>
              {error}
            </HelperText>
          )}
          {importMut.isPending && (
            <View style={styles.loading}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                Lecture de la page...
              </Text>
            </View>
          )}
        </Dialog.Content>

        <Dialog.Actions>
          <Button onPress={close} disabled={importMut.isPending}>
            Annuler
          </Button>
          <Button
            mode="contained"
            onPress={onSubmit}
            disabled={importMut.isPending || url.trim().length < 8}
            loading={importMut.isPending}
            icon="download"
          >
            Importer
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: { borderRadius: 16 },
  title: { fontWeight: '700' },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
});
