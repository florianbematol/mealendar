import { EmptyState } from '@/components/EmptyState';
import { GenerateRecipeModal } from '@/components/GenerateRecipeModal';
import { ImportRecipeModal } from '@/components/ImportRecipeModal';
import { Topbar } from '@/components/Topbar';
import { useHouseholdDetail } from '@/hooks/useHouseholds';
import { useRecipes, useToggleRecipeFavorite } from '@/hooks/useRecipes';
import { ApiError } from '@/lib/api';
import { useActiveHousehold } from '@/stores/activeHousehold';
import type { RecipeListItem } from '@mealendar/shared';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Chip,
  FAB,
  IconButton,
  Searchbar,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import { TouchableRipple } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function RecipesListScreen() {
  const theme = useTheme();
  const householdId = useActiveHousehold((s) => s.householdId);
  const recipes = useRecipes(householdId);
  const household = useHouseholdDetail(householdId);
  const memberCount = Math.max(1, household.data?.members.length ?? 4);
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [iaModalOpen, setIaModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const filtered = useMemo(() => {
    const items = recipes.data?.items ?? [];
    const q = query.trim().toLowerCase();
    return items.filter((r) => {
      const matchesQuery =
        !q || r.title.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q);
      const matchesFilter = !activeFilter || r.mealSlots.includes(activeFilter);
      const matchesFav = !favoritesOnly || r.isFavorite;
      return matchesQuery && matchesFilter && matchesFav;
    });
  }, [recipes.data, query, activeFilter, favoritesOnly]);

  const total = recipes.data?.items.length ?? 0;

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.colors.background }]}
      edges={['top']}
    >
      <Topbar />

      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text variant="headlineSmall" style={styles.title}>
            Recettes
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}>
            {total} dans votre bibliotheque
          </Text>
        </View>
      </View>

      <Searchbar
        placeholder="Rechercher une recette..."
        value={query}
        onChangeText={setQuery}
        style={[styles.search, { backgroundColor: theme.colors.surface }]}
        inputStyle={{ fontSize: 14 }}
        elevation={0}
      />

      {/* Filtres rapides par slot */}
      <View style={styles.filtersRow}>
        <FilterChip
          label="Toutes"
          active={activeFilter === null && !favoritesOnly}
          onPress={() => {
            setActiveFilter(null);
            setFavoritesOnly(false);
          }}
        />
        <FilterChip
          label="❤ Favoris"
          active={favoritesOnly}
          onPress={() => setFavoritesOnly((v) => !v)}
        />
        <FilterChip
          label="Petit-dej"
          active={activeFilter === 'breakfast'}
          onPress={() => setActiveFilter('breakfast')}
        />
        <FilterChip
          label="Dejeuner"
          active={activeFilter === 'lunch'}
          onPress={() => setActiveFilter('lunch')}
        />
        <FilterChip
          label="Diner"
          active={activeFilter === 'dinner'}
          onPress={() => setActiveFilter('dinner')}
        />
      </View>

      {recipes.isPending && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      )}

      {recipes.isError && (
        <View style={styles.center}>
          <Text variant="titleMedium">Erreur de chargement</Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
            {recipes.error instanceof ApiError
              ? `${recipes.error.status} - ${recipes.error.message}`
              : (recipes.error as Error).message}
          </Text>
        </View>
      )}

      {recipes.isSuccess && filtered.length === 0 && !query && !activeFilter && (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="silverware-fork-knife"
            title="Bibliotheque vide"
            description="Ajoutez vos premieres recettes maison ou inspirez-vous de l'IA pour commencer."
            cta={{
              label: "Generer avec l'IA",
              icon: 'auto-fix',
              onPress: () => setIaModalOpen(true),
            }}
            secondaryCta={{
              label: 'Creer manuellement',
              icon: 'pencil-outline',
              onPress: () => router.push('/(app)/(tabs)/recipes/new'),
            }}
          />
        </View>
      )}

      {recipes.isSuccess && filtered.length === 0 && (query || activeFilter) && (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="filter-off-outline"
            title="Aucun resultat"
            description="Aucune recette ne correspond a vos filtres. Essayez de modifier votre recherche."
          />
        </View>
      )}

      {recipes.isSuccess && filtered.length > 0 && (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <RecipeCard recipe={item} />}
          refreshControl={
            <RefreshControl
              refreshing={recipes.isFetching && !recipes.isPending}
              onRefresh={() => recipes.refetch()}
              tintColor={theme.colors.primary}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}

      <FAB.Group
        open={fabOpen}
        visible
        icon={fabOpen ? 'close' : 'plus'}
        onStateChange={({ open }) => setFabOpen(open)}
        // RN Paper FAB.Group ajoute paddingBottom = insets.bottom en interne.
        // On le compense par un margin negatif et on ajoute juste 5px pour ne pas
        // coller au bord de la tab bar.
        style={{ marginBottom: -insets.bottom + 5 }}
        actions={[
          {
            icon: 'auto-fix',
            label: "Generer avec l'IA",
            onPress: () => setIaModalOpen(true),
            color: theme.colors.onPrimary,
            style: { backgroundColor: theme.colors.secondary },
          },
          {
            icon: 'link-variant',
            label: 'Importer depuis URL',
            onPress: () => setImportModalOpen(true),
            color: theme.colors.onPrimary,
            style: { backgroundColor: theme.colors.tertiary },
          },
          {
            icon: 'pencil-outline',
            label: 'Creer manuellement',
            onPress: () => router.push('/(app)/(tabs)/recipes/new'),
            color: theme.colors.onPrimary,
            style: { backgroundColor: theme.colors.primary },
          },
        ]}
        fabStyle={{ backgroundColor: theme.colors.primary }}
        color={theme.colors.onPrimary}
      />

      <GenerateRecipeModal
        visible={iaModalOpen}
        onDismiss={() => setIaModalOpen(false)}
        onSuccess={(res) => {
          setIaModalOpen(false);
          if (res.recipeId) {
            router.push(`/(app)/(tabs)/recipes/${res.recipeId}`);
          }
        }}
        initialContext={{ servings: memberCount }}
      />

      <ImportRecipeModal
        visible={importModalOpen}
        onDismiss={() => setImportModalOpen(false)}
        onSuccess={(recipeId) => {
          setImportModalOpen(false);
          router.push(`/(app)/(tabs)/recipes/${recipeId}`);
        }}
      />
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Chip
      compact
      selected={active}
      onPress={onPress}
      style={{
        backgroundColor: active ? theme.colors.primary : theme.colors.surface,
      }}
      textStyle={{
        color: active ? theme.colors.onPrimary : theme.colors.onSurface,
        fontWeight: active ? '700' : '500',
      }}
      showSelectedCheck={false}
    >
      {label}
    </Chip>
  );
}

function RecipeCard({ recipe }: { recipe: RecipeListItem }) {
  const theme = useTheme();
  const total = (recipe.prepTimeMin ?? 0) + (recipe.cookTimeMin ?? 0) || null;
  const toggleFav = useToggleRecipeFavorite();

  return (
    <TouchableRipple
      onPress={() => router.push(`/(app)/(tabs)/recipes/${recipe.id}`)}
      borderless
      style={[styles.card, { backgroundColor: theme.colors.surface }]}
    >
      <View style={styles.cardInner}>
        <Surface
          elevation={0}
          style={[styles.thumb, { backgroundColor: theme.colors.primaryContainer }]}
        >
          {recipe.imageUrl ? (
            <Image source={recipe.imageUrl} style={styles.thumbImage} contentFit="cover" />
          ) : (
            <Text style={styles.thumbEmoji}>🍲</Text>
          )}
        </Surface>
        <View style={styles.cardBody}>
          <View style={styles.cardTitleRow}>
            <Text variant="titleMedium" style={[styles.cardTitle, { flex: 1 }]} numberOfLines={1}>
              {recipe.title}
            </Text>
            <IconButton
              icon={recipe.isFavorite ? 'heart' : 'heart-outline'}
              iconColor={recipe.isFavorite ? theme.colors.secondary : theme.colors.onSurfaceVariant}
              size={20}
              onPress={() => toggleFav.mutate({ id: recipe.id, householdId: recipe.householdId })}
              style={styles.favBtn}
            />
          </View>
          {recipe.description && (
            <Text
              variant="bodySmall"
              numberOfLines={1}
              style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
            >
              {recipe.description}
            </Text>
          )}
          <View style={styles.metaRow}>
            <Text
              variant="labelSmall"
              style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]}
            >
              {`👥 ${recipe.servings}`}
            </Text>
            {total !== null && (
              <Text
                variant="labelSmall"
                style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]}
              >
                {`⏱ ${total} min`}
              </Text>
            )}
            <Text
              variant="labelSmall"
              style={[styles.metaText, { color: theme.colors.onSurfaceVariant }]}
            >
              {`🥕 ${recipe.ingredientCount}`}
            </Text>
          </View>
        </View>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  title: { fontWeight: '700' },
  search: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
  },
  filtersRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
    flexWrap: 'wrap',
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 96,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyWrap: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  card: {
    borderRadius: 16,
    padding: 12,
  },
  cardInner: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  thumbEmoji: { fontSize: 30 },
  cardBody: { flex: 1 },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: { fontWeight: '700' },
  favBtn: { margin: 0, padding: 0, width: 32, height: 32 },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 6,
  },
  metaText: {
    fontSize: 12,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    borderRadius: 28,
  },
});
