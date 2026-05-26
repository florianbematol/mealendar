import { RecipeForm, type RecipeFormValue } from '@/components/RecipeForm';
import { useCreateRecipe } from '@/hooks/useRecipes';
import { ApiError } from '@/lib/api';
import { useActiveHousehold } from '@/stores/activeHousehold';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function NewRecipeScreen() {
  const theme = useTheme();
  const householdId = useActiveHousehold((s) => s.householdId);
  const create = useCreateRecipe();
  const [error, setError] = useState<string | null>(null);

  if (!householdId) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <Text>Aucun foyer actif.</Text>
      </View>
    );
  }

  const onSubmit = async (value: RecipeFormValue) => {
    setError(null);
    try {
      const created = await create.mutateAsync({ householdId, ...value });
      router.replace(`/(app)/(tabs)/recipes/${created.id}`);
    } catch (e) {
      if (e instanceof ApiError) setError(`${e.status} - ${e.message}`);
      else setError(e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={[]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <RecipeForm
          onSubmit={onSubmit}
          onCancel={() => router.back()}
          submitLabel="Creer la recette"
          isSubmitting={create.isPending}
          error={error}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
