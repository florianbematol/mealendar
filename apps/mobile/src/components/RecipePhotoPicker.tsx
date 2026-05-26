import { deleteRecipePhoto, getRecipePhotoUploadUrl, uploadFileToSignedUrl } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, IconButton, Surface, Text, useTheme } from 'react-native-paper';

export type RecipePhotoPickerProps = {
  recipeId: string;
  imageUrl: string | null;
  /**
   * Optionnel : appelle apres un upload reussi. Permet aux ecrans englobants
   * de mettre a jour l'etat (le hook React Query invalide deja la query recipe).
   */
  onChanged?: (newUrl: string | null) => void;
  /** Mode "compact" pour les ecrans avec peu de place (carre 120x120) */
  compact?: boolean;
};

type InferredType = {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  ext: string;
};

const TYPE_JPG: InferredType = { contentType: 'image/jpeg', ext: 'jpg' };
const TYPE_PNG: InferredType = { contentType: 'image/png', ext: 'png' };
const TYPE_WEBP: InferredType = { contentType: 'image/webp', ext: 'webp' };

const EXT_LOOKUP: Record<string, InferredType> = {
  jpg: TYPE_JPG,
  jpeg: TYPE_JPG,
  png: TYPE_PNG,
  webp: TYPE_WEBP,
};

function inferType(uri: string, mimeType?: string | null): InferredType {
  if (mimeType?.startsWith('image/')) {
    if (mimeType === 'image/jpeg') return TYPE_JPG;
    if (mimeType === 'image/png') return TYPE_PNG;
    if (mimeType === 'image/webp') return TYPE_WEBP;
  }
  const m = uri.toLowerCase().match(/\.([a-z0-9]{2,5})(?:\?|$)/);
  if (m?.[1]) {
    const known = EXT_LOOKUP[m[1]];
    if (known) return known;
  }
  return TYPE_JPG;
}

export function RecipePhotoPicker({
  recipeId,
  imageUrl,
  onChanged,
  compact = false,
}: RecipePhotoPickerProps) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const deleteMut = useMutation({
    mutationFn: () => deleteRecipePhoto(recipeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] });
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      onChanged?.(null);
    },
  });

  const upload = async (asset: { uri: string; mimeType?: string | null }): Promise<
    string | null
  > => {
    const type = inferType(asset.uri, asset.mimeType);
    setBusy(true);
    try {
      const signed = await getRecipePhotoUploadUrl(recipeId, type.contentType, type.ext);

      // Charge le fichier en blob (fetch local file URI fonctionne en RN)
      const fileRes = await fetch(asset.uri);
      const blob = await fileRes.blob();

      await uploadFileToSignedUrl(signed.signedUrl, blob, type.contentType);

      // Met a jour image_url via update_recipe RPC en passant par /api/recipes/:id
      // (on appelle directement la mutation TanStack via le helper API)
      const { updateRecipe } = await import('@/lib/api');
      await updateRecipe(recipeId, { imageUrl: signed.publicUrl });

      // Re-fetch
      queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] });
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      onChanged?.(signed.publicUrl);
      return signed.publicUrl;
    } catch (e) {
      Alert.alert("Echec de l'upload", e instanceof Error ? e.message : 'Erreur');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission refusee', "Mealendar n'a pas acces a vos photos.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (asset) await upload({ uri: asset.uri, mimeType: asset.mimeType ?? undefined });
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission refusee', "Mealendar n'a pas acces a la camera.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    if (asset) await upload({ uri: asset.uri, mimeType: asset.mimeType ?? undefined });
  };

  const onRemove = () => {
    Alert.alert('Supprimer la photo ?', '', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => deleteMut.mutate(),
      },
    ]);
  };

  const isLoading = busy || deleteMut.isPending;

  if (compact) {
    return (
      <View style={styles.compactRow}>
        <Surface
          elevation={0}
          style={[styles.compactThumb, { backgroundColor: theme.colors.primaryContainer }]}
        >
          {imageUrl ? (
            <Image source={imageUrl} style={styles.compactImage} contentFit="cover" />
          ) : (
            <Text style={styles.compactEmoji}>🍲</Text>
          )}
          {isLoading && (
            <View style={styles.compactLoader}>
              <ActivityIndicator color={theme.colors.onPrimaryContainer} />
            </View>
          )}
        </Surface>
        <View style={styles.compactActions}>
          <IconButton icon="camera" onPress={takePhoto} disabled={isLoading} size={20} />
          <IconButton
            icon="image-outline"
            onPress={pickFromLibrary}
            disabled={isLoading}
            size={20}
          />
          {imageUrl && (
            <IconButton
              icon="trash-can-outline"
              iconColor={theme.colors.error}
              onPress={onRemove}
              disabled={isLoading}
              size={20}
            />
          )}
        </View>
      </View>
    );
  }

  return (
    <Surface elevation={0} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
      <View style={[styles.preview, { backgroundColor: theme.colors.primaryContainer }]}>
        {imageUrl ? (
          <Image source={imageUrl} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Text style={styles.placeholderEmoji}>🍲</Text>
        )}
        {isLoading && (
          <View style={styles.previewLoader}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text
              variant="bodySmall"
              style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}
            >
              {deleteMut.isPending ? 'Suppression...' : 'Upload...'}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.actions}>
        <Button
          mode="contained-tonal"
          icon="camera"
          onPress={takePhoto}
          disabled={isLoading}
          style={styles.actionBtn}
        >
          Photo
        </Button>
        <Button
          mode="contained-tonal"
          icon="image-outline"
          onPress={pickFromLibrary}
          disabled={isLoading}
          style={styles.actionBtn}
        >
          Galerie
        </Button>
        {imageUrl && (
          <IconButton
            icon="trash-can-outline"
            iconColor={theme.colors.error}
            onPress={onRemove}
            disabled={isLoading}
            mode="outlined"
          />
        )}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    padding: 12,
    gap: 10,
  },
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  placeholderEmoji: { fontSize: 64 },
  previewLoader: {
    position: 'absolute',
    inset: 0 as unknown as undefined,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: { flex: 1, borderRadius: 10 },

  // compact mode
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactThumb: {
    width: 80,
    height: 80,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  compactImage: {
    width: '100%',
    height: '100%',
  },
  compactEmoji: { fontSize: 36 },
  compactLoader: {
    position: 'absolute',
    inset: 0 as unknown as undefined,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  compactActions: {
    flexDirection: 'row',
  },
});
