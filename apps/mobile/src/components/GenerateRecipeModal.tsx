import { useGenerateRecipe, useLlmQuota } from '@/hooks/useLlm';
import { ApiError } from '@/lib/api';
import { useActiveHousehold } from '@/stores/activeHousehold';
import type { DietComponent, GenerateRecipeResponse } from '@mealendar/shared';
import { useEffect, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  Dialog,
  HelperText,
  Portal,
  Surface,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';

const SLOT_OPTIONS = [
  { value: 'breakfast', label: 'Petit-dej' },
  { value: 'lunch', label: 'Dejeuner' },
  { value: 'snack', label: 'Gouter' },
  { value: 'dinner', label: 'Diner' },
];

const DIET_OPTIONS = [
  { value: 'vegetarian', label: 'Vegetarien' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'gluten_free', label: 'Sans gluten' },
  { value: 'lactose_free', label: 'Sans lactose' },
];

const PROMPT_SUGGESTIONS = [
  'Diner italien rapide',
  "Plat reconfortant pour soir d'hiver",
  "Salade fraiche d'ete",
  'Brunch du dimanche',
  'Recette antigaspi avec restes du frigo',
];

export type GenerateRecipeModalProps = {
  visible: boolean;
  onDismiss: () => void;
  onSuccess: (res: GenerateRecipeResponse) => void;
  /**
   * Pre-remplissage optionnel : contexte d'un slot du planning.
   * Si fourni, la modal pre-remplit les slots/composants et les transmet au LLM.
   */
  initialContext?: {
    prompt?: string;
    mealSlot?: string;
    servings?: number;
    dietComponents?: DietComponent[];
    /** Libelle informatif au-dessus du formulaire (ex : "Diner du Mercredi 27/05") */
    title?: string;
  };
};

export function GenerateRecipeModal({
  visible,
  onDismiss,
  onSuccess,
  initialContext,
}: GenerateRecipeModalProps) {
  const theme = useTheme();
  const householdId = useActiveHousehold((s) => s.householdId);
  const generate = useGenerateRecipe();
  const quota = useLlmQuota(visible);

  const [prompt, setPrompt] = useState(initialContext?.prompt ?? '');
  const [servings, setServings] = useState(String(initialContext?.servings ?? 4));
  const [maxKcal, setMaxKcal] = useState('');
  const [slots, setSlots] = useState<string[]>(
    initialContext?.mealSlot ? [initialContext.mealSlot] : [],
  );
  const [diets, setDiets] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Si la modal s'ouvre avec un nouveau contexte (slot du planning), on re-init
  // les champs depuis ce contexte. Sinon on garde l'etat saisi par l'utilisateur.
  useEffect(() => {
    if (!visible || !initialContext) return;
    setPrompt(initialContext.prompt ?? '');
    setServings(String(initialContext.servings ?? 4));
    setSlots(initialContext.mealSlot ? [initialContext.mealSlot] : []);
  }, [
    visible,
    initialContext,
    initialContext?.prompt,
    initialContext?.servings,
    initialContext?.mealSlot,
  ]);

  const reset = () => {
    setPrompt('');
    setServings('4');
    setMaxKcal('');
    setSlots([]);
    setDiets([]);
    setError(null);
  };

  const close = () => {
    reset();
    onDismiss();
  };

  const toggle = (list: string[], setter: (v: string[]) => void, value: string) =>
    setter(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const onSubmit = async () => {
    if (!householdId) return;
    Keyboard.dismiss();
    setError(null);
    const parsedServings = Number.parseInt(servings, 10);
    const parsedKcal = maxKcal ? Number.parseInt(maxKcal, 10) : null;
    try {
      const res = await generate.mutateAsync({
        householdId,
        prompt: prompt.trim(),
        servings:
          Number.isFinite(parsedServings) && parsedServings > 0 ? parsedServings : undefined,
        maxKcal: parsedKcal && parsedKcal > 0 ? parsedKcal : undefined,
        dietTags: diets,
        mealSlots: slots,
        avoidAllergens: [],
        save: true,
        dietComponents: initialContext?.dietComponents,
      });
      onSuccess(res);
      reset();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 503) {
          setError(
            "Generation IA indisponible : aucune cle API Gemini ou Groq n'est configuree cote serveur. Ajoutez GEMINI_API_KEY (gratuit sur aistudio.google.com) dans apps/api/.dev.vars puis relancez le backend.",
          );
        } else if (e.status === 429) {
          setError(
            "Quota IA atteint pour aujourd'hui. Reessayez demain ou cree la recette manuellement.",
          );
        } else {
          setError(`${e.status} - ${e.message}`);
        }
      } else {
        setError(e instanceof Error ? e.message : 'Erreur inconnue');
      }
    }
  };

  const canSubmit = !generate.isPending && prompt.trim().length >= 3;
  const remaining = quota.data?.remaining ?? null;

  return (
    <Portal>
      <Dialog
        visible={visible}
        onDismiss={close}
        style={[styles.dialog, { backgroundColor: theme.colors.background }]}
      >
        <Dialog.Title style={styles.title}>✨ Genere une recette</Dialog.Title>

        <Dialog.ScrollArea style={{ maxHeight: 460, paddingHorizontal: 0 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Decris l'idee de plat. Notre assistant culinaire imagine une recette complete avec les
              ingredients et les etapes.
            </Text>

            {initialContext?.title && (
              <Surface
                elevation={0}
                style={[styles.contextCard, { backgroundColor: theme.colors.primaryContainer }]}
              >
                <Text
                  variant="labelMedium"
                  style={{
                    color: theme.colors.onPrimaryContainer,
                    fontWeight: '700',
                    letterSpacing: 0.3,
                  }}
                >
                  📋 {initialContext.title}
                </Text>
                {initialContext.dietComponents && initialContext.dietComponents.length > 0 && (
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onPrimaryContainer, marginTop: 4 }}
                  >
                    L'IA respectera vos {initialContext.dietComponents.length} composant
                    {initialContext.dietComponents.length > 1 ? 's' : ''} du plan alimentaire.
                  </Text>
                )}
              </Surface>
            )}

            <TextInput
              mode="outlined"
              label="Ton idee"
              value={prompt}
              onChangeText={setPrompt}
              placeholder="Ex : risotto champignons creme"
              multiline
              numberOfLines={2}
              style={styles.input}
              maxLength={500}
            />

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.suggestRow}
            >
              {PROMPT_SUGGESTIONS.map((s) => (
                <Chip
                  key={s}
                  compact
                  onPress={() => setPrompt(s)}
                  style={{ backgroundColor: theme.colors.surfaceVariant }}
                  textStyle={{ fontSize: 11 }}
                >
                  {s}
                </Chip>
              ))}
            </ScrollView>

            <View style={styles.row2}>
              <TextInput
                mode="outlined"
                label="Portions"
                value={servings}
                onChangeText={setServings}
                keyboardType="number-pad"
                dense
                style={styles.flex1}
              />
              <TextInput
                mode="outlined"
                label="Max kcal/portion"
                value={maxKcal}
                onChangeText={setMaxKcal}
                keyboardType="number-pad"
                dense
                style={styles.flex1}
                placeholder="600"
              />
            </View>

            <Surface elevation={0} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
              <Text variant="labelMedium" style={styles.cardLabel}>
                Pour quels repas ?
              </Text>
              <View style={styles.chipsWrap}>
                {SLOT_OPTIONS.map((opt) => {
                  const active = slots.includes(opt.value);
                  return (
                    <Chip
                      key={opt.value}
                      compact
                      selected={active}
                      onPress={() => toggle(slots, setSlots, opt.value)}
                      style={{
                        backgroundColor: active
                          ? theme.colors.secondaryContainer
                          : theme.colors.surfaceVariant,
                      }}
                      showSelectedCheck={false}
                    >
                      {opt.label}
                    </Chip>
                  );
                })}
              </View>
            </Surface>

            <Surface elevation={0} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
              <Text variant="labelMedium" style={styles.cardLabel}>
                Regimes
              </Text>
              <View style={styles.chipsWrap}>
                {DIET_OPTIONS.map((opt) => {
                  const active = diets.includes(opt.value);
                  return (
                    <Chip
                      key={opt.value}
                      compact
                      selected={active}
                      onPress={() => toggle(diets, setDiets, opt.value)}
                      style={{
                        backgroundColor: active
                          ? theme.colors.tertiaryContainer
                          : theme.colors.surfaceVariant,
                      }}
                      showSelectedCheck={false}
                    >
                      {opt.label}
                    </Chip>
                  );
                })}
              </View>
            </Surface>

            {error && (
              <HelperText type="error" visible style={{ marginTop: 4 }}>
                {error}
              </HelperText>
            )}

            {remaining !== null && (
              <Text
                variant="labelSmall"
                style={[styles.quotaHint, { color: theme.colors.onSurfaceVariant }]}
              >
                {remaining > 0
                  ? `${remaining} generations restantes aujourd'hui`
                  : 'Quota quotidien atteint'}
              </Text>
            )}

            {generate.isPending && (
              <View style={styles.loadingBlock}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}
                >
                  L'IA prepare la recette... (10-20s)
                </Text>
              </View>
            )}
          </ScrollView>
        </Dialog.ScrollArea>

        <Dialog.Actions>
          <Button onPress={close} disabled={generate.isPending}>
            Annuler
          </Button>
          <Button
            mode="contained"
            onPress={onSubmit}
            disabled={!canSubmit || (remaining !== null && remaining <= 0)}
            loading={generate.isPending}
            icon="auto-fix"
          >
            Generer
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: { borderRadius: 16 },
  title: { fontWeight: '700' },
  scroll: { padding: 16, gap: 12 },
  contextCard: {
    padding: 12,
    borderRadius: 12,
  },
  input: { marginTop: 8 },
  suggestRow: { gap: 6, paddingVertical: 4 },
  row2: { flexDirection: 'row', gap: 8 },
  flex1: { flex: 1 },
  card: { padding: 12, borderRadius: 12, gap: 8 },
  cardLabel: { fontWeight: '700' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  quotaHint: { textAlign: 'center', marginTop: 4 },
  loadingBlock: { alignItems: 'center', gap: 8, paddingVertical: 8 },
});
