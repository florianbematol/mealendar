/**
 * MonthYearPicker : selecteur mois/annee en pur JS (aucun module natif).
 *
 * Remplace @react-native-community/datetimepicker (qui casse Expo Go).
 * Affiche une grille de 12 mois + une barre de navigation d'annee. Au choix
 * d'un mois, renvoie un YYYY-MM-01 via onConfirm.
 */
import { FR_MONTHS_SHORT, isoFromYearMonth, monthIndexOf, yearOf } from '@/lib/dates';
import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { IconButton, Modal, Portal, Text, useTheme } from 'react-native-paper';

export type MonthYearPickerProps = {
  visible: boolean;
  /** Valeur courante (YYYY-MM-DD), pour pre-selectionner mois + annee. */
  value: string;
  onConfirm: (isoMonth: string) => void;
  onDismiss: () => void;
};

export function MonthYearPicker({ visible, value, onConfirm, onDismiss }: MonthYearPickerProps) {
  const theme = useTheme();
  // Annee affichee dans la grille (peut differer de l'annee de `value` quand
  // l'utilisateur navigue avec les fleches avant de choisir un mois).
  const [year, setYear] = useState(() => yearOf(value));
  const selectedMonth = monthIndexOf(value);
  const selectedYear = yearOf(value);

  // Re-synchronise l'annee affichee a chaque ouverture.
  useEffect(() => {
    if (visible) setYear(yearOf(value));
  }, [visible, value]);

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.elevation.level2 }]}
      >
        {/* Navigation d'annee */}
        <View style={styles.yearBar}>
          <IconButton icon="chevron-left" onPress={() => setYear((y) => y - 1)} />
          <Text variant="titleLarge" style={styles.yearLabel}>
            {year}
          </Text>
          <IconButton icon="chevron-right" onPress={() => setYear((y) => y + 1)} />
        </View>

        {/* Grille 12 mois (4 x 3) */}
        <View style={styles.grid}>
          {FR_MONTHS_SHORT.map((label, idx) => {
            const isSelected = idx === selectedMonth && year === selectedYear;
            return (
              <TouchableOpacity
                key={label}
                style={[styles.monthCell, isSelected && { backgroundColor: theme.colors.primary }]}
                activeOpacity={0.7}
                onPress={() => onConfirm(isoFromYearMonth(year, idx))}
              >
                <Text
                  style={{
                    color: isSelected ? theme.colors.onPrimary : theme.colors.onSurface,
                    fontWeight: isSelected ? '800' : '500',
                  }}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modal: {
    marginHorizontal: 32,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  yearBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  yearLabel: { fontWeight: '800' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  monthCell: {
    width: '33.33%',
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    marginVertical: 2,
  },
});
