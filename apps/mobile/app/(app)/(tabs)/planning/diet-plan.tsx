import { Topbar } from '@/components/Topbar';
import { useMyDietPlan, useUpsertMyDietPlan } from '@/hooks/useDietPlans';
import { useMealPlan } from '@/hooks/usePlannings';
import { ApiError } from '@/lib/api';
import { useActiveHousehold } from '@/stores/activeHousehold';
import {
  DEFAULT_DIET_PLAN_TEMPLATE,
  type DietAlternative,
  type DietCategory,
  type DietComponent,
  type DietPlan,
  type Goal,
  type Regime,
} from '@mealendar/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Button,
  Chip,
  Dialog,
  Divider,
  HelperText,
  IconButton,
  Portal,
  Surface,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

const SLOT_LABELS: Record<string, string> = {
  breakfast: 'Petit-dejeuner',
  lunch: 'Dejeuner',
  snack: 'Gouter',
  dinner: 'Diner',
};

const ALL_SLOTS: string[] = ['breakfast', 'lunch', 'snack', 'dinner'];

const CATEGORY_OPTIONS: { value: DietCategory; label: string; emoji: string }[] = [
  { value: 'legumes', label: 'Legumes', emoji: '🥦' },
  { value: 'fruit', label: 'Fruit', emoji: '🍎' },
  { value: 'viande', label: 'Viande', emoji: '🥩' },
  { value: 'poisson', label: 'Poisson', emoji: '🐟' },
  { value: 'oeuf', label: 'Oeuf', emoji: '🥚' },
  { value: 'legumineuse', label: 'Legumineuse', emoji: '🫘' },
  { value: 'feculent', label: 'Feculent', emoji: '🍚' },
  { value: 'pain', label: 'Pain', emoji: '🍞' },
  { value: 'produit_laitier', label: 'Produit laitier', emoji: '🥛' },
  { value: 'fromage', label: 'Fromage', emoji: '🧀' },
  { value: 'fruits_a_coque', label: 'Fruits a coque', emoji: '🥜' },
  { value: 'matiere_grasse', label: 'Matiere grasse', emoji: '🫒' },
  { value: 'sucre', label: 'Sucre', emoji: '🍯' },
  { value: 'autre', label: 'Autre', emoji: '🍽️' },
];

const UNIT_OPTIONS = ['g', 'kg', 'ml', 'cl', 'l', 'piece', 'portion', 'c.a.s', 'c.a.c'];

function categoryLabel(c: DietCategory) {
  return CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}
function categoryEmoji(c: DietCategory) {
  return CATEGORY_OPTIONS.find((o) => o.value === c)?.emoji ?? '🍽️';
}

const REGIME_OPTIONS: { value: Regime; label: string }[] = [
  { value: 'vegetarian', label: 'Vegetarien' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'pescatarian', label: 'Pesco' },
  { value: 'gluten_free', label: 'Sans gluten' },
  { value: 'lactose_free', label: 'Sans lactose' },
  { value: 'halal', label: 'Halal' },
  { value: 'kosher', label: 'Casher' },
  { value: 'low_carb', label: 'Low carb' },
  { value: 'high_protein', label: 'Hyperproteine' },
];

const GOAL_OPTIONS: { value: Goal; label: string }[] = [
  { value: 'weight_loss', label: 'Perte de poids' },
  { value: 'weight_gain', label: 'Prise de poids' },
  { value: 'muscle_gain', label: 'Prise de masse' },
  { value: 'maintenance', label: 'Maintien' },
  { value: 'health_improvement', label: 'Amelioration sante' },
];

let __compUid = 0;
function makeCompId(prefix: string) {
  __compUid += 1;
  return `${prefix}-${Date.now()}-${__compUid}`;
}

export default function DietPlanScreen() {
  const theme = useTheme();
  const householdId = useActiveHousehold((s) => s.householdId);
  // mealPlan : on l'utilise uniquement pour connaitre les slots actifs
  const mealPlan = useMealPlan(householdId);
  const myDietPlan = useMyDietPlan(householdId);
  const upsert = useUpsertMyDietPlan();

  const [dietPlan, setDietPlan] = useState<DietPlan>({
    slots: {},
    dailyRules: [],
    note: null,
  });
  const [regimes, setRegimes] = useState<Regime[]>([]);
  const [allergiesText, setAllergiesText] = useState<string>('');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Init depuis l'existant si dispo
  useEffect(() => {
    if (myDietPlan.data) {
      setDietPlan(myDietPlan.data.dietPlan);
      setRegimes(myDietPlan.data.regimes);
      setAllergiesText(myDietPlan.data.allergies.join(', '));
      setGoals(myDietPlan.data.goals);
    }
  }, [myDietPlan.data]);

  // -- Composant editor (modal) ----------------------------------------------
  const [editing, setEditing] = useState<{
    slotKey: string | null; // null = dailyRules
    componentId: string | null; // null = nouveau
  } | null>(null);

  const allSlotsActive = Object.entries(dietPlan.slots).filter(
    ([_, comps]) => comps && comps.length > 0,
  );

  // Slots a afficher : ceux du plan-type configure + ceux deja presents dans dietPlan
  const slotsFromConfig = new Set<string>();
  if (mealPlan.data?.slotConfig) {
    for (const daySlots of Object.values(mealPlan.data.slotConfig)) {
      for (const s of daySlots ?? []) {
        slotsFromConfig.add(s.key);
      }
    }
  }
  for (const [k] of allSlotsActive) slotsFromConfig.add(k);

  const slotsToShow = ALL_SLOTS.filter((s) => slotsFromConfig.has(s));

  // Si aucun slot en plan-type, on montre lunch/dinner par defaut
  const visibleSlots = slotsToShow.length > 0 ? slotsToShow : ['lunch', 'dinner'];

  const componentsForSlot = (slotKey: string): DietComponent[] => {
    return dietPlan.slots[slotKey] ?? [];
  };

  const updateComponent = (
    slotKey: string | null,
    componentId: string | null,
    patch: DietComponent,
  ) => {
    setDietPlan((cur) => {
      if (slotKey === null) {
        // dailyRules
        const list = cur.dailyRules ?? [];
        const idx = list.findIndex((c) => c.id === componentId);
        const nextList = idx >= 0 ? list.map((c, i) => (i === idx ? patch : c)) : [...list, patch];
        return { ...cur, dailyRules: nextList };
      }
      const list = cur.slots[slotKey] ?? [];
      const idx = list.findIndex((c) => c.id === componentId);
      const nextList = idx >= 0 ? list.map((c, i) => (i === idx ? patch : c)) : [...list, patch];
      return { ...cur, slots: { ...cur.slots, [slotKey]: nextList } };
    });
  };

  const removeComponent = (slotKey: string | null, componentId: string) => {
    setDietPlan((cur) => {
      if (slotKey === null) {
        return {
          ...cur,
          dailyRules: (cur.dailyRules ?? []).filter((c) => c.id !== componentId),
        };
      }
      return {
        ...cur,
        slots: {
          ...cur.slots,
          [slotKey]: (cur.slots[slotKey] ?? []).filter((c) => c.id !== componentId),
        },
      };
    });
  };

  const onLoadTemplate = () => {
    setDietPlan(JSON.parse(JSON.stringify(DEFAULT_DIET_PLAN_TEMPLATE)) as DietPlan);
  };

  const onSave = async () => {
    if (!householdId) {
      setError('Aucun foyer actif.');
      return;
    }
    setError(null);
    // Parse les allergies "arachide, lactose, fraises" -> tableau lowercase
    const allergies = allergiesText
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && s.length <= 50);
    try {
      await upsert.mutateAsync({
        householdId,
        dietPlan,
        regimes,
        allergies,
        goals,
      });
      router.back();
    } catch (e) {
      if (e instanceof ApiError) setError(`${e.status} - ${e.message}`);
      else setError(e instanceof Error ? e.message : 'Erreur inconnue');
    }
  };

  if (myDietPlan.isPending || mealPlan.isPending) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  // Si pas de plan-type, on previent que les sections par slot ne pourront pas etre
  // affichees correctement (les slots sont tires du plan-type). Mais on peut quand
  // meme remplir regimes/allergies/goals.
  if (!mealPlan.data) {
    return (
      <SafeAreaView
        style={[styles.safe, { backgroundColor: theme.colors.background }]}
        edges={['top']}
      >
        <Topbar />
        <View style={styles.center}>
          <Text variant="titleMedium">Pas de plan-type</Text>
          <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 8, textAlign: 'center' }}>
            Configurez d'abord les slots de votre plan-type.
          </Text>
          <Button
            mode="contained"
            onPress={() => router.replace('/(app)/(tabs)/planning/meal-plan')}
            style={{ marginTop: 16, borderRadius: 12 }}
          >
            Configurer le plan-type
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]} edges={[]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.container}>
          <Surface elevation={0} style={[styles.intro, { backgroundColor: theme.colors.surface }]}>
            <Text variant="titleMedium" style={styles.introTitle}>
              📋 Mon plan alimentaire
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}
            >
              Votre profil personnel : regimes, allergies, objectifs et besoins par repas. Quand un
              repas concerne plusieurs membres, leurs besoins sont additionnes.
            </Text>
            <Button
              mode="contained-tonal"
              icon="auto-fix"
              onPress={onLoadTemplate}
              style={{ marginTop: 12, borderRadius: 10 }}
              compact
            >
              Charger le modele equilibre
            </Button>
          </Surface>

          {/* Regimes */}
          <Surface
            elevation={0}
            style={[styles.slotCard, { backgroundColor: theme.colors.surface }]}
          >
            <Text variant="titleMedium" style={styles.slotTitle}>
              Regimes
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Selectionnez tous ceux qui s'appliquent a vous.
            </Text>
            <View style={styles.tagsWrap}>
              {REGIME_OPTIONS.map((opt) => {
                const active = regimes.includes(opt.value);
                return (
                  <Chip
                    key={opt.value}
                    compact
                    selected={active}
                    onPress={() =>
                      setRegimes((cur) =>
                        active ? cur.filter((r) => r !== opt.value) : [...cur, opt.value],
                      )
                    }
                    style={{
                      backgroundColor: active
                        ? theme.colors.primaryContainer
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

          {/* Allergies */}
          <Surface
            elevation={0}
            style={[styles.slotCard, { backgroundColor: theme.colors.surface }]}
          >
            <Text variant="titleMedium" style={styles.slotTitle}>
              Allergies / intolerances
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Liste libre, separee par des virgules.
            </Text>
            <TextInput
              mode="outlined"
              value={allergiesText}
              onChangeText={setAllergiesText}
              placeholder="Ex : arachide, lactose, fraises"
              dense
              style={{ marginTop: 8 }}
            />
          </Surface>

          {/* Objectifs */}
          <Surface
            elevation={0}
            style={[styles.slotCard, { backgroundColor: theme.colors.surface }]}
          >
            <Text variant="titleMedium" style={styles.slotTitle}>
              Objectifs
            </Text>
            <View style={styles.tagsWrap}>
              {GOAL_OPTIONS.map((opt) => {
                const active = goals.includes(opt.value);
                return (
                  <Chip
                    key={opt.value}
                    compact
                    selected={active}
                    onPress={() =>
                      setGoals((cur) =>
                        active ? cur.filter((g) => g !== opt.value) : [...cur, opt.value],
                      )
                    }
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

          <Divider style={styles.divider} />

          <Text variant="labelLarge" style={styles.sectionHeader}>
            Composants par repas
          </Text>

          {visibleSlots.map((slotKey) => {
            const components = componentsForSlot(slotKey);
            return (
              <Surface
                key={slotKey}
                elevation={0}
                style={[styles.slotCard, { backgroundColor: theme.colors.surface }]}
              >
                <View style={styles.slotHeader}>
                  <Text variant="titleMedium" style={styles.slotTitle}>
                    {SLOT_LABELS[slotKey] ?? slotKey}
                  </Text>
                  <Button
                    compact
                    icon="plus"
                    onPress={() => setEditing({ slotKey, componentId: null })}
                    mode="text"
                  >
                    Ajouter
                  </Button>
                </View>
                {components.length === 0 ? (
                  <Text style={{ color: theme.colors.onSurfaceVariant, fontStyle: 'italic' }}>
                    Aucun composant defini.
                  </Text>
                ) : (
                  components.map((comp) => (
                    <ComponentRow
                      key={comp.id}
                      component={comp}
                      onEdit={() => setEditing({ slotKey, componentId: comp.id })}
                      onRemove={() => removeComponent(slotKey, comp.id)}
                    />
                  ))
                )}
              </Surface>
            );
          })}

          <Divider style={styles.divider} />

          {/* Regles journalieres */}
          <Surface
            elevation={0}
            style={[styles.slotCard, { backgroundColor: theme.colors.surface }]}
          >
            <View style={styles.slotHeader}>
              <Text variant="titleMedium" style={styles.slotTitle}>
                Regles journalieres
              </Text>
              <Button
                compact
                icon="plus"
                onPress={() => setEditing({ slotKey: null, componentId: null })}
                mode="text"
              >
                Ajouter
              </Button>
            </View>
            {(dietPlan.dailyRules ?? []).length === 0 ? (
              <Text style={{ color: theme.colors.onSurfaceVariant, fontStyle: 'italic' }}>
                Ex : matieres grasses 2-3 c.a.s par jour, sucres ajoutes max 2 c.a.c...
              </Text>
            ) : (
              (dietPlan.dailyRules ?? []).map((c) => (
                <ComponentRow
                  key={c.id}
                  component={c}
                  onEdit={() => setEditing({ slotKey: null, componentId: c.id })}
                  onRemove={() => removeComponent(null, c.id)}
                />
              ))
            )}
          </Surface>

          {error && (
            <HelperText type="error" visible style={{ marginTop: 4 }}>
              {error}
            </HelperText>
          )}
        </ScrollView>

        <Surface
          elevation={0}
          style={[styles.bottomBar, { backgroundColor: theme.colors.surface }]}
        >
          <Button mode="text" onPress={() => router.back()} disabled={upsert.isPending}>
            Annuler
          </Button>
          <Button
            mode="contained"
            onPress={onSave}
            loading={upsert.isPending}
            disabled={upsert.isPending}
            icon="check"
            style={{ borderRadius: 12 }}
          >
            Enregistrer
          </Button>
        </Surface>
      </KeyboardAvoidingView>

      {editing && (
        <ComponentEditor
          slotKey={editing.slotKey}
          existing={
            editing.componentId
              ? editing.slotKey === null
                ? ((dietPlan.dailyRules ?? []).find((c) => c.id === editing.componentId) ?? null)
                : ((dietPlan.slots[editing.slotKey] ?? []).find(
                    (c) => c.id === editing.componentId,
                  ) ?? null)
              : null
          }
          onSave={(comp) => {
            updateComponent(editing.slotKey, editing.componentId, comp);
            setEditing(null);
          }}
          onDismiss={() => setEditing(null)}
        />
      )}
    </SafeAreaView>
  );
}

// ============================================================================
// ComponentRow : ligne resumant un composant (label + alternatives en chips)
// ============================================================================
function ComponentRow({
  component,
  onEdit,
  onRemove,
}: {
  component: DietComponent;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  return (
    <Surface elevation={0} style={[styles.compRow, { backgroundColor: theme.colors.background }]}>
      <View style={{ flex: 1 }}>
        <View style={styles.compHeader}>
          <Text variant="titleSmall" style={styles.compLabel}>
            {component.label}
            {!component.required && (
              <Text style={{ color: theme.colors.onSurfaceVariant }}> (optionnel)</Text>
            )}
          </Text>
        </View>
        <View style={styles.altsWrap}>
          {component.alternatives.map((alt, idx) => (
            <Chip
              key={`${alt.category}-${idx}`}
              compact
              style={{ backgroundColor: theme.colors.primaryContainer }}
              textStyle={{ fontSize: 11, color: theme.colors.onPrimaryContainer }}
            >
              {`${categoryEmoji(alt.category)} ${alt.label}${formatQty(alt)}`}
            </Chip>
          ))}
        </View>
        {component.note && (
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
            {component.note}
          </Text>
        )}
      </View>
      <View style={styles.compActions}>
        <IconButton icon="pencil-outline" size={18} onPress={onEdit} style={styles.compIconBtn} />
        <IconButton
          icon="trash-can-outline"
          size={18}
          iconColor={theme.colors.error}
          onPress={onRemove}
          style={styles.compIconBtn}
        />
      </View>
    </Surface>
  );
}

function formatQty(alt: DietAlternative): string {
  const min = alt.qtyMin;
  const max = alt.qtyMax;
  const u = alt.unit ? ` ${alt.unit}` : '';
  if (min == null && max == null) return '';
  if (min != null && max != null && min !== max) return ` ${min}-${max}${u}`;
  return ` ${min ?? max}${u}`;
}

// ============================================================================
// ComponentEditor : modal d'edition d'un composant + ses alternatives
// ============================================================================
function ComponentEditor({
  slotKey,
  existing,
  onSave,
  onDismiss,
}: {
  slotKey: string | null;
  existing: DietComponent | null;
  onSave: (comp: DietComponent) => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const [label, setLabel] = useState(existing?.label ?? '');
  const [required, setRequired] = useState(existing?.required ?? true);
  const [note, setNote] = useState(existing?.note ?? '');
  const [alternatives, setAlternatives] = useState<(DietAlternative & { _uid: string })[]>(
    (
      existing?.alternatives ?? [
        { category: 'legumes', label: 'Legumes', qtyMin: 100, qtyMax: 300, unit: 'g' },
      ]
    ).map((a, i) => ({ ...a, _uid: `alt-${Date.now()}-${i}` })),
  );

  const updateAlt = (idx: number, patch: Partial<DietAlternative>) => {
    setAlternatives((cur) => cur.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  };
  const addAlt = () =>
    setAlternatives((cur) => [
      ...cur,
      {
        category: 'autre',
        label: '',
        qtyMin: null,
        qtyMax: null,
        unit: 'g',
        _uid: `alt-${Date.now()}-${cur.length}`,
      },
    ]);
  const removeAlt = (idx: number) =>
    setAlternatives((cur) => (cur.length === 1 ? cur : cur.filter((_, i) => i !== idx)));

  const onSubmit = () => {
    const cleaned: DietComponent = {
      id: existing?.id ?? makeCompId(slotKey ?? 'daily'),
      label: label.trim() || 'Composant',
      required,
      note: note.trim() || null,
      alternatives: alternatives
        .map((a) => {
          const { _uid, ...rest } = a;
          return {
            ...rest,
            label: rest.label.trim() || categoryLabel(rest.category),
          };
        })
        .filter((a) => a.label.length > 0),
    };
    if (cleaned.alternatives.length === 0) {
      cleaned.alternatives = [
        { category: 'autre', label: 'Alternative', qtyMin: null, qtyMax: null, unit: null },
      ];
    }
    onSave(cleaned);
  };

  return (
    <Portal>
      <Dialog
        visible
        onDismiss={onDismiss}
        style={[styles.dialog, { backgroundColor: theme.colors.background }]}
      >
        <Dialog.Title>{existing ? 'Modifier le composant' : 'Nouveau composant'}</Dialog.Title>
        <Dialog.ScrollArea style={{ maxHeight: 460, paddingHorizontal: 0 }}>
          <ScrollView
            contentContainerStyle={styles.dialogScroll}
            keyboardShouldPersistTaps="handled"
          >
            <TextInput
              mode="outlined"
              label="Nom du composant"
              value={label}
              onChangeText={setLabel}
              placeholder="Ex : Proteine"
              maxLength={100}
              dense
            />
            <View style={styles.requiredRow}>
              <Chip
                compact
                selected={required}
                onPress={() => setRequired(true)}
                style={{
                  backgroundColor: required
                    ? theme.colors.primaryContainer
                    : theme.colors.surfaceVariant,
                }}
                showSelectedCheck={false}
              >
                Obligatoire
              </Chip>
              <Chip
                compact
                selected={!required}
                onPress={() => setRequired(false)}
                style={{
                  backgroundColor: !required
                    ? theme.colors.tertiaryContainer
                    : theme.colors.surfaceVariant,
                }}
                showSelectedCheck={false}
              >
                Optionnel
              </Chip>
            </View>

            <Text variant="labelLarge" style={styles.altsTitle}>
              Alternatives ({alternatives.length})
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Pour ce composant, l'utilisateur peut choisir parmi ces options.
            </Text>

            {alternatives.map((alt, idx) => (
              <Surface
                key={alt._uid}
                elevation={0}
                style={[styles.altCard, { backgroundColor: theme.colors.surface }]}
              >
                <View style={styles.altHeader}>
                  <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                    Alternative {idx + 1}
                  </Text>
                  <IconButton
                    icon="trash-can-outline"
                    size={16}
                    iconColor={theme.colors.error}
                    disabled={alternatives.length === 1}
                    onPress={() => removeAlt(idx)}
                    style={{ margin: 0 }}
                  />
                </View>

                <TextInput
                  mode="outlined"
                  label="Nom"
                  value={alt.label}
                  onChangeText={(v) => updateAlt(idx, { label: v })}
                  placeholder="Ex : Viande"
                  dense
                />

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.catRow}
                >
                  {CATEGORY_OPTIONS.map((opt) => {
                    const active = alt.category === opt.value;
                    return (
                      <Chip
                        key={opt.value}
                        compact
                        selected={active}
                        onPress={() => updateAlt(idx, { category: opt.value })}
                        style={{
                          backgroundColor: active
                            ? theme.colors.primaryContainer
                            : theme.colors.surfaceVariant,
                        }}
                        showSelectedCheck={false}
                      >
                        {`${opt.emoji} ${opt.label}`}
                      </Chip>
                    );
                  })}
                </ScrollView>

                <View style={styles.qtyRow}>
                  <TextInput
                    mode="outlined"
                    label="Min"
                    value={alt.qtyMin == null ? '' : String(alt.qtyMin)}
                    onChangeText={(v) =>
                      updateAlt(idx, {
                        qtyMin: v ? Number.parseFloat(v.replace(',', '.')) : null,
                      })
                    }
                    keyboardType="numeric"
                    dense
                    style={styles.flex1}
                  />
                  <TextInput
                    mode="outlined"
                    label="Max"
                    value={alt.qtyMax == null ? '' : String(alt.qtyMax)}
                    onChangeText={(v) =>
                      updateAlt(idx, {
                        qtyMax: v ? Number.parseFloat(v.replace(',', '.')) : null,
                      })
                    }
                    keyboardType="numeric"
                    dense
                    style={styles.flex1}
                  />
                  <TextInput
                    mode="outlined"
                    label="Unite"
                    value={alt.unit ?? ''}
                    onChangeText={(v) => updateAlt(idx, { unit: v || null })}
                    dense
                    style={styles.flex1}
                  />
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.catRow}
                >
                  {UNIT_OPTIONS.map((u) => (
                    <Chip
                      key={u}
                      compact
                      selected={alt.unit === u}
                      onPress={() => updateAlt(idx, { unit: u })}
                      style={{
                        backgroundColor:
                          alt.unit === u
                            ? theme.colors.secondaryContainer
                            : theme.colors.surfaceVariant,
                      }}
                      showSelectedCheck={false}
                      textStyle={{ fontSize: 11 }}
                    >
                      {u}
                    </Chip>
                  ))}
                </ScrollView>
              </Surface>
            ))}

            <Button mode="text" icon="plus" onPress={addAlt}>
              Ajouter une alternative
            </Button>

            <TextInput
              mode="outlined"
              label="Note (optionnelle)"
              value={note}
              onChangeText={setNote}
              placeholder="Ex : ou moitie-moitie"
              dense
              maxLength={200}
            />
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Annuler</Button>
          <Button mode="contained" onPress={onSubmit}>
            Enregistrer
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { padding: 16, gap: 12, paddingBottom: 24 },

  intro: { padding: 16, borderRadius: 14 },
  introTitle: { fontWeight: '700' },

  slotCard: { padding: 14, borderRadius: 14, gap: 8 },
  slotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  slotTitle: { fontWeight: '700' },

  compRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 10,
    borderRadius: 10,
    gap: 6,
  },
  compHeader: { flexDirection: 'row', alignItems: 'center' },
  compLabel: { fontWeight: '700' },
  altsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  compActions: { flexDirection: 'row' },
  compIconBtn: { margin: 0 },

  divider: { marginVertical: 8 },

  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  sectionHeader: {
    fontWeight: '700',
    marginTop: 4,
    marginBottom: 4,
    paddingHorizontal: 4,
  },

  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.04)',
  },

  // Editor dialog
  dialog: { borderRadius: 16 },
  dialogScroll: { padding: 16, gap: 10 },
  requiredRow: { flexDirection: 'row', gap: 6 },
  altsTitle: { fontWeight: '700', marginTop: 8 },
  altCard: { padding: 12, borderRadius: 12, gap: 8 },
  altHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  catRow: { gap: 6, paddingVertical: 4 },
  qtyRow: { flexDirection: 'row', gap: 6 },
  flex1: { flex: 1 },
});
