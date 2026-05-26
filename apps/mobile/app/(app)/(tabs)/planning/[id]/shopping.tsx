import { useShoppingList } from '@/hooks/usePlannings';
import { ApiError } from '@/lib/api';
import type { ShoppingItem } from '@mealendar/shared';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Checkbox,
  IconButton,
  Searchbar,
  Surface,
  Text,
  TouchableRipple,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ShoppingListScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const list = useShoppingList(id);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');

  const toggle = (key: string) => setChecked((prev) => ({ ...prev, [key]: !prev[key] }));

  const items = list.data?.items ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.ingredientName.toLowerCase().includes(q));
  }, [items, query]);

  const remaining = items.filter((it) => !checked[keyOf(it)]).length;

  const onShare = async () => {
    const text = items.map((it) => `- ${formatItem(it)}`).join('\n');
    try {
      await Share.share({
        title: 'Liste de courses Mealendar',
        message: `Liste de courses (Mealendar)\n\n${text}`,
      });
    } catch {
      // share annule
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={[]}>
      <View style={styles.headerRow}>
        <Text variant="titleLarge" style={styles.title}>
          {items.length} ingredient{items.length > 1 ? 's' : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <IconButton
            icon="share-variant"
            onPress={onShare}
            disabled={items.length === 0}
            iconColor={theme.colors.onSurfaceVariant}
          />
          <IconButton
            icon="refresh"
            onPress={() => list.refetch()}
            loading={list.isFetching}
            iconColor={theme.colors.onSurfaceVariant}
          />
        </View>
      </View>

      <Searchbar
        placeholder="Rechercher..."
        value={query}
        onChangeText={setQuery}
        style={[styles.search, { backgroundColor: theme.colors.surface }]}
        inputStyle={{ fontSize: 14 }}
        elevation={0}
      />

      {list.isPending && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      )}

      {list.isError && (
        <View style={styles.center}>
          <Text variant="titleMedium">Erreur de chargement</Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
            {list.error instanceof ApiError
              ? `${list.error.status} - ${list.error.message}`
              : (list.error as Error).message}
          </Text>
        </View>
      )}

      {list.isSuccess && items.length === 0 && (
        <Surface elevation={0} style={[styles.empty, { backgroundColor: theme.colors.surface }]}>
          <Text style={styles.emptyEmoji}>🛒</Text>
          <Text variant="titleMedium" style={styles.emptyTitle}>
            Liste vide
          </Text>
          <Text
            variant="bodySmall"
            style={[styles.emptyBody, { color: theme.colors.onSurfaceVariant }]}
          >
            Ajoutez des recettes au planning pour generer la liste de courses.
          </Text>
        </Surface>
      )}

      {list.isSuccess && items.length > 0 && (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={list.isFetching && !list.isPending}
              onRefresh={() => list.refetch()}
              tintColor={theme.colors.primary}
            />
          }
        >
          <Text
            variant="labelMedium"
            style={[styles.remaining, { color: theme.colors.onSurfaceVariant }]}
          >
            {remaining} a acheter
          </Text>
          {filtered.map((it) => {
            const key = keyOf(it);
            const isChecked = !!checked[key];
            return (
              <TouchableRipple
                key={key}
                onPress={() => toggle(key)}
                borderless
                style={[styles.row, { backgroundColor: theme.colors.surface }]}
              >
                <View style={styles.rowInner}>
                  <Checkbox.Android
                    status={isChecked ? 'checked' : 'unchecked'}
                    onPress={() => toggle(key)}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      variant="bodyLarge"
                      style={[
                        styles.itemName,
                        isChecked && {
                          textDecorationLine: 'line-through',
                          color: theme.colors.onSurfaceVariant,
                        },
                      ]}
                    >
                      {it.ingredientName}
                    </Text>
                    {(it.totalQuantity != null || it.unit) && (
                      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {it.totalQuantity ?? '—'}
                        {it.unit ? ` ${it.unit}` : ''}
                        {it.recipeIds.length > 0
                          ? `  ·  ${it.recipeIds.length} recette${
                              it.recipeIds.length > 1 ? 's' : ''
                            }`
                          : ''}
                      </Text>
                    )}
                  </View>
                </View>
              </TouchableRipple>
            );
          })}
          <Button
            mode="text"
            onPress={() => setChecked({})}
            disabled={Object.keys(checked).length === 0}
            style={{ marginTop: 16 }}
          >
            Tout decocher
          </Button>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function keyOf(it: ShoppingItem): string {
  return `${it.ingredientName.toLowerCase()}|${it.unit ?? ''}`;
}

function formatItem(it: ShoppingItem): string {
  const qty = it.totalQuantity != null ? `${it.totalQuantity}${it.unit ? ` ${it.unit}` : ''} ` : '';
  return `${qty}${it.ingredientName}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  title: { fontWeight: '700' },
  search: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    borderRadius: 12,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: {
    margin: 16,
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  emptyEmoji: { fontSize: 36, marginBottom: 8 },
  emptyTitle: { fontWeight: '700' },
  emptyBody: { textAlign: 'center', marginTop: 4 },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  remaining: { letterSpacing: 0.5, marginBottom: 8 },
  row: {
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  itemName: { fontWeight: '600' },
});
