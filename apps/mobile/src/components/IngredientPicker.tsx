import { useSearchIngredients } from '@/hooks/useIngredients';
import type { Ingredient } from '@mealendar/shared';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  IconButton,
  Portal,
  Searchbar,
  Surface,
  Text,
  TouchableRipple,
  useTheme,
} from 'react-native-paper';

export type IngredientPickerProps = {
  visible: boolean;
  householdId: string | null | undefined;
  initialQuery?: string;
  onPick: (ing: Ingredient) => void;
  onPickFreeText?: (text: string) => void;
  onScanBarcode?: () => void;
  onDismiss: () => void;
};

/**
 * Modal d'autocomplete d'ingredient.
 * - Recherche locale (foyer + cache OFF) avec debounce
 * - Chaque resultat est cliquable
 * - Bouton scan code-barres en haut a droite
 * - Bouton "Utiliser '<texte>'" si l'utilisateur veut un nom libre non en base
 */
export function IngredientPicker({
  visible,
  householdId,
  initialQuery,
  onPick,
  onPickFreeText,
  onScanBarcode,
  onDismiss,
}: IngredientPickerProps) {
  const theme = useTheme();
  const [query, setQuery] = useState(initialQuery ?? '');
  const search = useSearchIngredients(householdId, query, 20);
  const items = search.data?.items ?? [];

  return (
    <Portal>
      <Dialog
        visible={visible}
        onDismiss={onDismiss}
        style={[styles.dialog, { backgroundColor: theme.colors.background }]}
      >
        <View style={styles.header}>
          <Text variant="titleMedium" style={styles.title}>
            Choisir un ingredient
          </Text>
          {onScanBarcode && (
            <IconButton
              icon="barcode-scan"
              size={22}
              onPress={onScanBarcode}
              iconColor={theme.colors.primary}
            />
          )}
        </View>

        <Searchbar
          placeholder="Rechercher (ex : tomate, riz...)"
          value={query}
          onChangeText={setQuery}
          style={[styles.search, { backgroundColor: theme.colors.surface }]}
          inputStyle={{ fontSize: 14 }}
          elevation={0}
          autoFocus
        />

        <Dialog.ScrollArea style={{ maxHeight: 380, paddingHorizontal: 0 }}>
          {search.isFetching && items.length === 0 && (
            <View style={styles.loaderRow}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
            </View>
          )}

          {!search.isFetching && items.length === 0 && (
            <View style={styles.emptyRow}>
              <Text style={{ color: theme.colors.onSurfaceVariant }}>
                {query.trim().length === 0
                  ? 'Tapez quelques lettres pour rechercher.'
                  : `Aucun resultat pour "${query.trim()}".`}
              </Text>
              {query.trim().length >= 2 && onPickFreeText && (
                <Button
                  mode="contained-tonal"
                  icon="plus"
                  style={{ marginTop: 12 }}
                  onPress={() => {
                    onPickFreeText(query.trim());
                  }}
                >
                  {`Utiliser "${query.trim()}"`}
                </Button>
              )}
            </View>
          )}

          {items.length > 0 && (
            <FlatList
              data={items}
              keyExtractor={(it) => it.id}
              renderItem={({ item }) => <Row ingredient={item} onPick={onPick} />}
              ItemSeparatorComponent={() => <View style={styles.sep} />}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </Dialog.ScrollArea>

        <Dialog.Actions>
          <Button onPress={onDismiss}>Annuler</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

function Row({
  ingredient,
  onPick,
}: {
  ingredient: Ingredient;
  onPick: (ing: Ingredient) => void;
}) {
  const theme = useTheme();
  const macros = formatMacros(ingredient);
  return (
    <TouchableRipple onPress={() => onPick(ingredient)}>
      <View style={styles.row}>
        <Surface
          elevation={0}
          style={[
            styles.thumb,
            {
              backgroundColor:
                ingredient.householdId === null
                  ? theme.colors.tertiaryContainer
                  : theme.colors.primaryContainer,
            },
          ]}
        >
          <Text style={styles.thumbEmoji}>{ingredient.householdId === null ? '🛒' : '🥕'}</Text>
        </Surface>
        <View style={{ flex: 1 }}>
          <Text variant="bodyMedium" style={styles.rowTitle} numberOfLines={1}>
            {ingredient.name}
          </Text>
          {macros && (
            <Text
              variant="labelSmall"
              numberOfLines={1}
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              {macros}
            </Text>
          )}
        </View>
      </View>
    </TouchableRipple>
  );
}

function formatMacros(ing: Ingredient): string | null {
  const parts: string[] = [];
  if (ing.kcal100g != null) parts.push(`${Math.round(ing.kcal100g)} kcal`);
  if (ing.protein100g != null) parts.push(`P ${Math.round(ing.protein100g)}g`);
  if (ing.carbs100g != null) parts.push(`G ${Math.round(ing.carbs100g)}g`);
  if (ing.fat100g != null) parts.push(`L ${Math.round(ing.fat100g)}g`);
  if (parts.length === 0) return null;
  return `${parts.join(' · ')} / 100g`;
}

const styles = StyleSheet.create({
  dialog: {
    borderRadius: 16,
    paddingTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 24,
    paddingRight: 12,
  },
  title: { fontWeight: '700' },
  search: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
  },
  loaderRow: { padding: 24, alignItems: 'center' },
  emptyRow: { padding: 24, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbEmoji: { fontSize: 18 },
  rowTitle: { fontWeight: '600' },
  sep: { height: 1, backgroundColor: 'rgba(0,0,0,0.04)' },
});
