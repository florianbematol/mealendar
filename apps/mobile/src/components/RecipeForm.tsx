import { BarcodeScannerModal } from '@/components/BarcodeScannerModal';
import { IngredientPicker } from '@/components/IngredientPicker';
import { StepsEditor } from '@/components/StepsEditor';
import { useActiveHousehold } from '@/stores/activeHousehold';
import type {
  CreateRecipeInput,
  Ingredient,
  RecipeStep,
  RecipeWithIngredients,
} from '@mealendar/shared';
import { useMemo, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Chip,
  HelperText,
  IconButton,
  ProgressBar,
  Surface,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';

const DIET_TAG_OPTIONS: { value: string; label: string }[] = [
  { value: 'vegetarian', label: 'Vegetarien' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'pescatarian', label: 'Pesco' },
  { value: 'gluten_free', label: 'Sans gluten' },
  { value: 'lactose_free', label: 'Sans lactose' },
];

const SLOT_OPTIONS: { value: string; label: string; emoji: string }[] = [
  { value: 'breakfast', label: 'Petit-dej', emoji: '☕' },
  { value: 'lunch', label: 'Dejeuner', emoji: '🍽️' },
  { value: 'snack', label: 'Gouter', emoji: '🥨' },
  { value: 'dinner', label: 'Diner', emoji: '🌙' },
];

const COMMON_UNITS = ['g', 'kg', 'ml', 'cl', 'l', 'piece', 'c.a.s', 'c.a.c'];

let __ingUid = 0;
function makeUid() {
  __ingUid += 1;
  return `ing-${Date.now()}-${__ingUid}`;
}

export type RecipeFormValue = Omit<CreateRecipeInput, 'householdId'>;

export type RecipeFormProps = {
  initial?: RecipeWithIngredients | null;
  onSubmit: (value: RecipeFormValue) => Promise<void> | void;
  submitLabel: string;
  onCancel?: () => void;
  isSubmitting?: boolean;
  error?: string | null;
};

type IngredientRow = {
  uid: string;
  name: string;
  quantity: string;
  unit: string;
  ingredientId: string | null;
};

const STEP_LABELS = ['Essentiel', 'Ingredients', 'Details'];

export function RecipeForm({
  initial,
  onSubmit,
  submitLabel,
  onCancel,
  isSubmitting,
  error,
}: RecipeFormProps) {
  const theme = useTheme();
  const [step, setStep] = useState<0 | 1 | 2>(0);

  // Etape 1 - Essentiel
  const [title, setTitle] = useState(initial?.title ?? '');
  const [servings, setServings] = useState(String(initial?.servings ?? 4));
  const [prepTime, setPrepTime] = useState(
    initial?.prepTimeMin != null ? String(initial.prepTimeMin) : '',
  );
  const [cookTime, setCookTime] = useState(
    initial?.cookTimeMin != null ? String(initial.cookTimeMin) : '',
  );
  const [mealSlots, setMealSlots] = useState<string[]>(initial?.mealSlots ?? []);
  const [dietTags, setDietTags] = useState<string[]>(initial?.dietTags ?? []);

  // Etape 2 - Ingredients
  const [ingredients, setIngredients] = useState<IngredientRow[]>(
    initial?.ingredients?.length
      ? initial.ingredients.map((i) => ({
          uid: makeUid(),
          name: i.ingredientName,
          quantity: i.quantity != null ? String(i.quantity) : '',
          unit: i.unit ?? '',
          ingredientId: i.ingredientId,
        }))
      : [{ uid: makeUid(), name: '', quantity: '', unit: '', ingredientId: null }],
  );

  // Active household pour la recherche d'ingredients
  const householdId = useActiveHousehold((s) => s.householdId);

  // Modaux : autocomplete ingredient + scan code-barres
  const [pickerOpenForUid, setPickerOpenForUid] = useState<string | null>(null);
  const [scannerOpenForUid, setScannerOpenForUid] = useState<string | null>(null);

  // Etape 3 - Details
  const [description, setDescription] = useState(initial?.description ?? '');
  const [steps, setSteps] = useState<RecipeStep[]>(initial?.steps ?? []);

  // Helpers
  const toggle = (list: string[], setter: (v: string[]) => void, value: string) =>
    setter(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const setIngAt = (idx: number, patch: Partial<Omit<IngredientRow, 'uid'>>) =>
    setIngredients((cur) => cur.map((i, k) => (k === idx ? { ...i, ...patch } : i)));

  const addIngredient = () =>
    setIngredients((cur) => [
      ...cur,
      { uid: makeUid(), name: '', quantity: '', unit: '', ingredientId: null },
    ]);

  const removeIngredient = (uid: string) =>
    setIngredients((cur) => (cur.length === 1 ? cur : cur.filter((i) => i.uid !== uid)));

  const applyIngredientPick = (uid: string, ing: Ingredient) => {
    setIngredients((cur) =>
      cur.map((row) =>
        row.uid === uid
          ? {
              ...row,
              name: ing.name,
              ingredientId: ing.id,
              unit: row.unit || ing.defaultUnit,
            }
          : row,
      ),
    );
    setPickerOpenForUid(null);
    setScannerOpenForUid(null);
  };

  const applyFreeText = (uid: string, text: string) => {
    setIngredients((cur) =>
      cur.map((row) => (row.uid === uid ? { ...row, name: text, ingredientId: null } : row)),
    );
    setPickerOpenForUid(null);
  };

  const canGoNext = useMemo(() => {
    if (step === 0) return title.trim().length > 0;
    if (step === 1) return ingredients.some((i) => i.name.trim().length > 0);
    return true;
  }, [step, title, ingredients]);

  const handleSubmit = () => {
    Keyboard.dismiss();
    const parsedServings = Number.parseInt(servings, 10);
    const parsedPrep = prepTime ? Number.parseInt(prepTime, 10) : null;
    const parsedCook = cookTime ? Number.parseInt(cookTime, 10) : null;

    const cleanedIngredients = ingredients
      .filter((i) => i.name.trim().length > 0)
      .map((i) => ({
        ingredientId: i.ingredientId ?? null,
        name: i.name.trim(),
        quantity: i.quantity.trim() ? Number.parseFloat(i.quantity.replace(',', '.')) : null,
        unit: i.unit.trim() || null,
      }));

    void onSubmit({
      title: title.trim(),
      description: description.trim() || null,
      servings: Number.isFinite(parsedServings) && parsedServings > 0 ? parsedServings : 4,
      prepTimeMin: parsedPrep,
      cookTimeMin: parsedCook,
      steps: steps.filter((s) => s.text.trim().length > 0),
      dietTags,
      mealSlots,
      ingredients: cleanedIngredients,
    });
  };

  const next = () => {
    if (step < 2) {
      setStep((step + 1) as 0 | 1 | 2);
    } else {
      handleSubmit();
    }
  };

  const prev = () => {
    if (step === 0) onCancel?.();
    else setStep((step - 1) as 0 | 1 | 2);
  };

  return (
    <View style={styles.root}>
      {/* Progress header */}
      <Surface
        elevation={0}
        style={[styles.progressBar, { backgroundColor: theme.colors.surface }]}
      >
        <View style={styles.progressRow}>
          {STEP_LABELS.map((label, idx) => (
            <View key={label} style={styles.progressItem}>
              <View
                style={[
                  styles.progressDot,
                  {
                    backgroundColor:
                      idx <= step ? theme.colors.primary : theme.colors.surfaceVariant,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.progressDotText,
                    {
                      color: idx <= step ? theme.colors.onPrimary : theme.colors.onSurfaceVariant,
                    },
                  ]}
                >
                  {idx + 1}
                </Text>
              </View>
              <Text
                variant="labelSmall"
                style={[
                  styles.progressLabel,
                  {
                    color: idx === step ? theme.colors.primary : theme.colors.onSurfaceVariant,
                    fontWeight: idx === step ? '700' : '500',
                  },
                ]}
              >
                {label}
              </Text>
            </View>
          ))}
        </View>
        <ProgressBar
          progress={(step + 1) / 3}
          color={theme.colors.primary}
          style={styles.progressLine}
        />
      </Surface>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {step === 0 && (
          <View style={{ gap: 14 }}>
            <Text variant="titleMedium" style={styles.stepTitle}>
              On commence par les bases
            </Text>
            <TextInput
              mode="outlined"
              label="Nom de la recette *"
              value={title}
              onChangeText={setTitle}
              maxLength={200}
              left={<TextInput.Icon icon="silverware-fork-knife" />}
              placeholder="Ex : Quiche aux poireaux"
            />

            <Surface elevation={0} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
              <Text variant="labelLarge" style={styles.cardLabel}>
                Quantites
              </Text>
              <View style={styles.row3}>
                <TextInput
                  mode="outlined"
                  label="Portions"
                  value={servings}
                  onChangeText={setServings}
                  keyboardType="number-pad"
                  style={styles.flex1}
                  dense
                />
                <TextInput
                  mode="outlined"
                  label="Prep (min)"
                  value={prepTime}
                  onChangeText={setPrepTime}
                  keyboardType="number-pad"
                  style={styles.flex1}
                  dense
                />
                <TextInput
                  mode="outlined"
                  label="Cuisson"
                  value={cookTime}
                  onChangeText={setCookTime}
                  keyboardType="number-pad"
                  style={styles.flex1}
                  dense
                />
              </View>
            </Surface>

            <Surface elevation={0} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
              <Text variant="labelLarge" style={styles.cardLabel}>
                Pour quels repas ?
              </Text>
              <View style={styles.chipsWrap}>
                {SLOT_OPTIONS.map((opt) => {
                  const active = mealSlots.includes(opt.value);
                  return (
                    <Chip
                      key={opt.value}
                      selected={active}
                      onPress={() => toggle(mealSlots, setMealSlots, opt.value)}
                      style={{
                        backgroundColor: active
                          ? theme.colors.secondaryContainer
                          : theme.colors.surfaceVariant,
                      }}
                      showSelectedCheck={false}
                    >
                      {`${opt.emoji}  ${opt.label}`}
                    </Chip>
                  );
                })}
              </View>
            </Surface>

            <Surface elevation={0} style={[styles.card, { backgroundColor: theme.colors.surface }]}>
              <Text variant="labelLarge" style={styles.cardLabel}>
                Regimes adaptes
              </Text>
              <View style={styles.chipsWrap}>
                {DIET_TAG_OPTIONS.map((opt) => {
                  const active = dietTags.includes(opt.value);
                  return (
                    <Chip
                      key={opt.value}
                      selected={active}
                      onPress={() => toggle(dietTags, setDietTags, opt.value)}
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
          </View>
        )}

        {step === 1 && (
          <View style={{ gap: 10 }}>
            <Text variant="titleMedium" style={styles.stepTitle}>
              Les ingredients
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Listez chaque ingredient avec sa quantite et son unite.
            </Text>

            {ingredients.map((ing, idx) => (
              <Surface
                key={ing.uid}
                elevation={0}
                style={[styles.ingCard, { backgroundColor: theme.colors.surface }]}
              >
                <View style={styles.ingHeaderRow}>
                  <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                    Ingredient {idx + 1}
                    {ing.ingredientId && (
                      <Text style={{ color: theme.colors.primary }}> · 🔗 lie</Text>
                    )}
                  </Text>
                  <IconButton
                    icon="trash-can-outline"
                    size={18}
                    iconColor={theme.colors.error}
                    disabled={ingredients.length === 1}
                    onPress={() => removeIngredient(ing.uid)}
                    style={{ margin: 0 }}
                  />
                </View>
                <View style={styles.ingNameRow}>
                  <TextInput
                    mode="outlined"
                    label="Nom"
                    value={ing.name}
                    onChangeText={(v) => setIngAt(idx, { name: v, ingredientId: null })}
                    dense
                    placeholder="Ex : Tomate, Riz blanc..."
                    style={styles.flex1}
                  />
                  <IconButton
                    icon="magnify"
                    mode="outlined"
                    size={20}
                    onPress={() => setPickerOpenForUid(ing.uid)}
                    style={styles.ingActionBtn}
                  />
                  <IconButton
                    icon="barcode-scan"
                    mode="outlined"
                    size={20}
                    onPress={() => setScannerOpenForUid(ing.uid)}
                    style={styles.ingActionBtn}
                  />
                </View>
                <View style={styles.ingQtyRow}>
                  <TextInput
                    mode="outlined"
                    label="Quantite"
                    value={ing.quantity}
                    onChangeText={(v) => setIngAt(idx, { quantity: v })}
                    keyboardType="numeric"
                    dense
                    style={styles.flex1}
                  />
                  <TextInput
                    mode="outlined"
                    label="Unite"
                    value={ing.unit}
                    onChangeText={(v) => setIngAt(idx, { unit: v })}
                    dense
                    style={styles.flex1}
                    placeholder="g"
                  />
                </View>
                {ing.unit.length === 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.unitSuggest}
                  >
                    {COMMON_UNITS.map((u) => (
                      <Chip
                        key={u}
                        compact
                        onPress={() => setIngAt(idx, { unit: u })}
                        style={{ backgroundColor: theme.colors.surfaceVariant }}
                        textStyle={{ fontSize: 11 }}
                      >
                        {u}
                      </Chip>
                    ))}
                  </ScrollView>
                )}
              </Surface>
            ))}

            <Button
              mode="contained-tonal"
              icon="plus"
              onPress={addIngredient}
              style={styles.addBtn}
            >
              Ajouter un ingredient
            </Button>
          </View>
        )}

        {step === 2 && (
          <View style={{ gap: 14 }}>
            <Text variant="titleMedium" style={styles.stepTitle}>
              Pour finir, quelques details
            </Text>
            <TextInput
              mode="outlined"
              label="Description (optionnelle)"
              value={description}
              onChangeText={setDescription}
              maxLength={2000}
              multiline
              numberOfLines={3}
              placeholder="Ex : Plat reconfortant pour les soirs d'hiver..."
            />
            <Text variant="labelLarge" style={styles.stepTitle}>
              Etapes
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: theme.colors.onSurfaceVariant, marginTop: -8 }}
            >
              Une etape = une action courte. Indiquez la duree pour les etapes chronometrees
              (cuisson, repos).
            </Text>
            <StepsEditor value={steps} onChange={setSteps} />
          </View>
        )}

        {error && (
          <HelperText type="error" visible style={{ marginTop: 4 }}>
            {error}
          </HelperText>
        )}
      </ScrollView>

      {/* Modaux ingredient picker + barcode scanner */}
      {pickerOpenForUid && (
        <IngredientPicker
          visible
          householdId={householdId}
          onPick={(ing) => applyIngredientPick(pickerOpenForUid, ing)}
          onPickFreeText={(text) => applyFreeText(pickerOpenForUid, text)}
          onScanBarcode={() => {
            const uid = pickerOpenForUid;
            setPickerOpenForUid(null);
            setScannerOpenForUid(uid);
          }}
          onDismiss={() => setPickerOpenForUid(null)}
        />
      )}
      {scannerOpenForUid && (
        <BarcodeScannerModal
          visible
          onResolved={(ing) => applyIngredientPick(scannerOpenForUid, ing)}
          onDismiss={() => setScannerOpenForUid(null)}
        />
      )}

      {/* Bottom navigation */}
      <Surface elevation={0} style={[styles.bottomNav, { backgroundColor: theme.colors.surface }]}>
        <Button
          mode="text"
          onPress={prev}
          disabled={isSubmitting}
          icon="chevron-left"
          textColor={theme.colors.onSurfaceVariant}
        >
          {step === 0 ? 'Annuler' : 'Retour'}
        </Button>
        <Button
          mode="contained"
          onPress={next}
          disabled={!canGoNext || isSubmitting}
          loading={isSubmitting && step === 2}
          icon={step === 2 ? 'check' : 'chevron-right'}
          contentStyle={step === 2 ? undefined : styles.nextBtnContent}
          style={styles.nextBtn}
        >
          {step === 2 ? submitLabel : 'Suivant'}
        </Button>
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  progressBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.04)',
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressItem: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  progressDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressDotText: { fontSize: 12, fontWeight: '700' },
  progressLabel: { fontSize: 11 },
  progressLine: {
    height: 4,
    borderRadius: 2,
  },
  scroll: {
    padding: 16,
    paddingBottom: 24,
  },
  stepTitle: { fontWeight: '700' },
  card: {
    padding: 14,
    borderRadius: 14,
    gap: 10,
  },
  cardLabel: {
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  row3: { flexDirection: 'row', gap: 8 },
  flex1: { flex: 1 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ingCard: {
    padding: 12,
    borderRadius: 14,
    gap: 8,
  },
  ingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ingNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ingActionBtn: {
    margin: 0,
    borderRadius: 10,
  },
  ingQtyRow: { flexDirection: 'row', gap: 8 },
  unitSuggest: { gap: 6 },
  addBtn: { borderRadius: 12, marginTop: 4 },

  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.04)',
  },
  nextBtn: { borderRadius: 12 },
  nextBtnContent: { flexDirection: 'row-reverse' },
});
