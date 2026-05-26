import { NutritionCard } from '@/components/NutritionCard';
import { RecipeForm, type RecipeFormValue } from '@/components/RecipeForm';
import { RecipePhotoPicker } from '@/components/RecipePhotoPicker';
import { useRecipeMacros } from '@/hooks/useIngredients';
import {
  useDeleteRecipe,
  useRecipe,
  useToggleRecipeFavorite,
  useUpdateRecipe,
} from '@/hooks/useRecipes';
import { ApiError } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  IconButton,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function RecipeDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const recipe = useRecipe(id);
  const update = useUpdateRecipe(id ?? '');
  const del = useDeleteRecipe();
  const toggleFav = useToggleRecipeFavorite();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Header dynamique
  useLayoutEffect(() => {
    navigation.setOptions({
      title: recipe.data?.title ?? 'Recette',
      headerRight: () =>
        recipe.data && !editing ? (
          <View style={{ flexDirection: 'row' }}>
            <IconButton
              icon={recipe.data.isFavorite ? 'heart' : 'heart-outline'}
              iconColor={recipe.data.isFavorite ? theme.colors.secondary : undefined}
              onPress={() => {
                if (!recipe.data) return;
                haptics.medium();
                toggleFav.mutate({
                  id: recipe.data.id,
                  householdId: recipe.data.householdId,
                });
              }}
              size={20}
            />
            <IconButton icon="pencil-outline" onPress={() => setEditing(true)} size={20} />
            <IconButton
              icon="trash-can-outline"
              iconColor={theme.colors.error}
              onPress={() => {
                Alert.alert('Supprimer la recette', 'Cette action est irreversible.', [
                  { text: 'Annuler', style: 'cancel' },
                  {
                    text: 'Supprimer',
                    style: 'destructive',
                    onPress: async () => {
                      if (!recipe.data) return;
                      try {
                        await del.mutateAsync({
                          id: recipe.data.id,
                          householdId: recipe.data.householdId,
                        });
                        router.replace('/(app)/(tabs)/recipes');
                      } catch (e) {
                        Alert.alert('Erreur', e instanceof Error ? e.message : 'Erreur inconnue');
                      }
                    },
                  },
                ]);
              }}
              size={20}
            />
          </View>
        ) : null,
    });
  }, [
    navigation,
    recipe.data,
    editing,
    theme.colors.error,
    theme.colors.secondary,
    del,
    toggleFav,
  ]);

  useEffect(() => {
    setError(null);
  }, []);

  const onSave = async (value: RecipeFormValue) => {
    setError(null);
    try {
      await update.mutateAsync(value);
      setEditing(false);
    } catch (e) {
      if (e instanceof ApiError) setError(`${e.status} - ${e.message}`);
      else setError(e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  const totalTime = useMemo(() => {
    if (!recipe.data) return null;
    const t = (recipe.data.prepTimeMin ?? 0) + (recipe.data.cookTimeMin ?? 0);
    return t > 0 ? t : null;
  }, [recipe.data]);

  const { macros } = useRecipeMacros(recipe.data ?? null);

  if (recipe.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }
  if (recipe.isError) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <Text variant="titleMedium">Erreur de chargement</Text>
        <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
          {(recipe.error as Error).message}
        </Text>
      </View>
    );
  }
  const r = recipe.data;
  if (!r) return null;

  if (editing) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={[]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.safe}
        >
          <RecipeForm
            initial={r}
            onSubmit={onSave}
            onCancel={() => setEditing(false)}
            submitLabel="Enregistrer"
            isSubmitting={update.isPending}
            error={error}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={[]}>
      <ScrollView contentContainerStyle={styles.container}>
        {r.imageUrl ? (
          <Surface
            elevation={0}
            style={[styles.heroImageWrap, { backgroundColor: theme.colors.primaryContainer }]}
          >
            <Image source={r.imageUrl} style={styles.heroImage} contentFit="cover" />
            <View style={styles.heroOverlay}>
              <Text variant="headlineSmall" style={styles.heroOverlayTitle}>
                {r.title}
              </Text>
              {r.description && (
                <Text variant="bodySmall" style={styles.heroOverlayDesc} numberOfLines={2}>
                  {r.description}
                </Text>
              )}
            </View>
          </Surface>
        ) : (
          <Surface
            elevation={0}
            style={[styles.headerCard, { backgroundColor: theme.colors.primaryContainer }]}
          >
            <Text style={styles.headerEmoji}>🍲</Text>
            <Text
              variant="headlineSmall"
              style={[styles.headerTitle, { color: theme.colors.onPrimaryContainer }]}
            >
              {r.title}
            </Text>
            {r.description && (
              <Text
                variant="bodyMedium"
                style={{
                  color: theme.colors.onPrimaryContainer,
                  marginTop: 6,
                  textAlign: 'center',
                }}
              >
                {r.description}
              </Text>
            )}
            <View style={styles.headerMeta}>
              <Chip compact icon="account-multiple" style={styles.metaChip}>
                {`${r.servings} pers.`}
              </Chip>
              {totalTime !== null && (
                <Chip compact icon="clock-outline" style={styles.metaChip}>
                  {`${totalTime} min`}
                </Chip>
              )}
              {r.source !== 'user' && (
                <Chip compact icon="robot-outline" style={styles.metaChip}>
                  {r.source.toUpperCase()}
                </Chip>
              )}
            </View>
          </Surface>
        )}

        {/* Photo manager (toujours visible pour permettre l'ajout/maj) */}
        <RecipePhotoPicker recipeId={r.id} imageUrl={r.imageUrl} compact />

        {r.imageUrl && (
          <View style={styles.metaChipsRow}>
            <Chip compact icon="account-multiple">{`${r.servings} pers.`}</Chip>
            {totalTime !== null && <Chip compact icon="clock-outline">{`${totalTime} min`}</Chip>}
            {r.source !== 'user' && (
              <Chip compact icon="robot-outline">
                {r.source.toUpperCase()}
              </Chip>
            )}
          </View>
        )}

        {(r.dietTags.length > 0 || r.mealSlots.length > 0) && (
          <Surface
            elevation={0}
            style={[styles.section, { backgroundColor: theme.colors.surface }]}
          >
            <View style={styles.tagsRow}>
              {r.mealSlots.map((s) => (
                <Chip
                  key={`slot-${s}`}
                  compact
                  icon="silverware"
                  style={{ backgroundColor: theme.colors.secondaryContainer }}
                >
                  {s}
                </Chip>
              ))}
              {r.dietTags.map((t) => (
                <Chip
                  key={`diet-${t}`}
                  compact
                  icon="leaf"
                  style={{ backgroundColor: theme.colors.tertiaryContainer }}
                >
                  {t}
                </Chip>
              ))}
            </View>
          </Surface>
        )}

        {macros && macros.contributingCount > 0 && (
          <NutritionCard macros={macros} servings={r.servings} perServing />
        )}

        <Surface elevation={0} style={[styles.section, { backgroundColor: theme.colors.surface }]}>
          <Text variant="labelLarge" style={styles.sectionTitle}>
            Ingredients
          </Text>
          {r.ingredients.length === 0 ? (
            <Text style={{ color: theme.colors.onSurfaceVariant }}>
              Aucun ingredient renseigne.
            </Text>
          ) : (
            <View style={{ gap: 8 }}>
              {r.ingredients.map((i, idx) => (
                <View key={`${i.position}-${idx}`} style={styles.ingLine}>
                  <Text style={styles.ingDot}>•</Text>
                  <Text variant="bodyMedium" style={{ flex: 1 }}>
                    <Text style={styles.ingQty}>
                      {i.quantity != null ? `${i.quantity}${i.unit ? ` ${i.unit}` : ''} ` : ''}
                    </Text>
                    {i.ingredientName}
                    {i.notes ? (
                      <Text style={{ color: theme.colors.onSurfaceVariant }}>
                        {` (${i.notes})`}
                      </Text>
                    ) : null}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Surface>

        {r.steps.length > 0 ? (
          <Surface
            elevation={0}
            style={[styles.section, { backgroundColor: theme.colors.surface }]}
          >
            <Text variant="labelLarge" style={styles.sectionTitle}>
              Etapes
            </Text>
            <View style={styles.stepsList}>
              {r.steps.map((s, idx) => (
                <View key={s.id} style={styles.stepRow}>
                  <View
                    style={[styles.stepBadge, { backgroundColor: theme.colors.primaryContainer }]}
                  >
                    <Text
                      style={[styles.stepBadgeText, { color: theme.colors.onPrimaryContainer }]}
                    >
                      {idx + 1}
                    </Text>
                  </View>
                  <View style={styles.stepBody}>
                    <Text variant="bodyMedium" style={{ lineHeight: 20 }}>
                      {s.text}
                    </Text>
                    {s.durationMin != null && s.durationMin > 0 ? (
                      <Text
                        variant="labelSmall"
                        style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
                      >
                        ⏱ {s.durationMin} min
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          </Surface>
        ) : null}

        <Button
          mode="outlined"
          icon="pencil-outline"
          onPress={() => setEditing(true)}
          style={styles.editBtn}
        >
          Modifier la recette
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: {
    padding: 16,
    gap: 12,
    paddingBottom: 32,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heroImageWrap: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 20,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
  },
  heroOverlay: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: 16,
    paddingTop: 24,
  },
  heroOverlayTitle: { color: '#fff', fontWeight: '800' },
  heroOverlayDesc: { color: '#fff', opacity: 0.92, marginTop: 4 },
  metaChipsRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  headerCard: {
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  headerEmoji: { fontSize: 40, marginBottom: 8 },
  headerTitle: { fontWeight: '700', textAlign: 'center' },
  headerMeta: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  metaChip: { backgroundColor: '#fff' },
  section: { borderRadius: 16, padding: 16 },
  sectionTitle: { fontWeight: '700', letterSpacing: 0.3, marginBottom: 12 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ingLine: { flexDirection: 'row', gap: 6 },
  ingDot: { width: 12, fontWeight: '700' },
  ingQty: { fontWeight: '700' },
  stepsList: { gap: 12 },
  stepRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: { fontWeight: '700', fontSize: 13 },
  stepBody: { flex: 1 },
  editBtn: { borderRadius: 12, marginTop: 8 },
});
