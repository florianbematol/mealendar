/**
 * Editeur de steps de recette : liste de cards reordonnables avec
 * texte + duree optionnelle. L'utilisateur peut ajouter, supprimer,
 * deplacer une etape, et editer chaque champ.
 *
 * State controle de l'exterieur : value (RecipeStep[]) + onChange.
 */
import type { RecipeStep } from '@mealendar/shared';
import { StyleSheet, View } from 'react-native';
import { Button, IconButton, Surface, Text, TextInput, useTheme } from 'react-native-paper';

let __stepUid = 0;
function makeStepId() {
  __stepUid += 1;
  return `s-${Date.now()}-${__stepUid}`;
}

export type StepsEditorProps = {
  value: RecipeStep[];
  onChange: (next: RecipeStep[]) => void;
};

export function StepsEditor({ value, onChange }: StepsEditorProps) {
  const theme = useTheme();

  const addStep = () => {
    onChange([...value, { id: makeStepId(), text: '', durationMin: null }]);
  };

  const removeStep = (id: string) => {
    onChange(value.filter((s) => s.id !== id));
  };

  const updateStep = (id: string, patch: Partial<RecipeStep>) => {
    onChange(value.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const moveStep = (id: string, dir: -1 | 1) => {
    const idx = value.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    const [moved] = next.splice(idx, 1);
    if (moved) next.splice(target, 0, moved);
    onChange(next);
  };

  return (
    <View style={styles.root}>
      {value.length === 0 ? (
        <Surface
          elevation={0}
          style={[styles.emptyCard, { backgroundColor: theme.colors.surfaceVariant }]}
        >
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Aucune etape pour l'instant.
          </Text>
        </Surface>
      ) : (
        value.map((s, idx) => (
          <Surface
            key={s.id}
            elevation={0}
            style={[styles.stepCard, { backgroundColor: theme.colors.surface }]}
          >
            <View style={styles.stepHeader}>
              <View style={[styles.stepBadge, { backgroundColor: theme.colors.primaryContainer }]}>
                <Text style={[styles.stepBadgeText, { color: theme.colors.onPrimaryContainer }]}>
                  {idx + 1}
                </Text>
              </View>
              <View style={styles.headerActions}>
                <IconButton
                  icon="arrow-up"
                  size={18}
                  disabled={idx === 0}
                  onPress={() => moveStep(s.id, -1)}
                  style={styles.iconBtn}
                />
                <IconButton
                  icon="arrow-down"
                  size={18}
                  disabled={idx === value.length - 1}
                  onPress={() => moveStep(s.id, 1)}
                  style={styles.iconBtn}
                />
                <IconButton
                  icon="trash-can-outline"
                  size={18}
                  iconColor={theme.colors.error}
                  onPress={() => removeStep(s.id)}
                  style={styles.iconBtn}
                />
              </View>
            </View>
            <TextInput
              mode="outlined"
              value={s.text}
              onChangeText={(text) => updateStep(s.id, { text })}
              placeholder="Decrivez l'etape (ex : Faire revenir l'oignon)"
              multiline
              dense
              style={styles.textInput}
            />
            <View style={styles.durationRow}>
              <Text
                variant="labelSmall"
                style={{ color: theme.colors.onSurfaceVariant, marginRight: 8 }}
              >
                Duree (min)
              </Text>
              <TextInput
                mode="outlined"
                value={s.durationMin != null ? String(s.durationMin) : ''}
                onChangeText={(v) => {
                  const n = Number.parseInt(v, 10);
                  updateStep(s.id, {
                    durationMin: Number.isFinite(n) && n >= 0 ? n : null,
                  });
                }}
                keyboardType="number-pad"
                placeholder="-"
                dense
                style={styles.durationInput}
              />
            </View>
          </Surface>
        ))
      )}
      <Button
        mode="contained-tonal"
        icon="plus"
        onPress={addStep}
        style={styles.addBtn}
        contentStyle={styles.addBtnContent}
      >
        Ajouter une etape
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  emptyCard: {
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  stepCard: {
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: { fontWeight: '700', fontSize: 13 },
  headerActions: { flexDirection: 'row' },
  iconBtn: { margin: 0 },
  textInput: {
    minHeight: 60,
  },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  durationInput: {
    width: 80,
  },
  addBtn: {
    borderRadius: 10,
    marginTop: 4,
  },
  addBtnContent: { paddingVertical: 4 },
});
