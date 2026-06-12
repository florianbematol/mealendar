/**
 * MonthCalendar : grille mensuelle custom facon FamilyWall.
 *
 * - 7 colonnes (lundi -> dimanche), 6 rangees qui remplissent la hauteur.
 * - Chaque cellule : numero du jour en haut + bandes colorees nommees pour
 *   les plages (meal_plan_ranges) qui traversent ce jour.
 * - Les bandes sont continues d'un jour a l'autre (overlay absolu par rangee)
 *   avec le nom de la plage affiche sur la 1ere cellule de la rangee.
 *
 * Composant "pur" : il recoit les plages + un mois de reference, et notifie
 * le parent au tap sur un jour. Aucune logique de fetch ici.
 */
import { WEEKDAYS, WEEKDAY_LABELS, isSameMonth, monthGrid, todayIso } from '@/lib/dates';
import type { MealPlanRange } from '@mealendar/shared';
import { memo, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from 'react-native-paper';

// Palette de couleurs pour les bandes de plage (hash deterministe du nom).
const RANGE_COLORS: { bg: string; text: string }[] = [
  { bg: '#3F7D58', text: '#FFFFFF' }, // sage
  { bg: '#C57148', text: '#FFFFFF' }, // terracotta
  { bg: '#5B7CB1', text: '#FFFFFF' }, // bleu
  { bg: '#B85C7E', text: '#FFFFFF' }, // rose
  { bg: '#8B5CB8', text: '#FFFFFF' }, // violet
  { bg: '#C9A227', text: '#FFFFFF' }, // or
  { bg: '#5C8B83', text: '#FFFFFF' }, // teal
  { bg: '#A05C3F', text: '#FFFFFF' }, // brun
];

function colorForRange(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const idx = ((hash % RANGE_COLORS.length) + RANGE_COLORS.length) % RANGE_COLORS.length;
  return RANGE_COLORS[idx] as { bg: string; text: string };
}

// Assigne a chaque plage une "lane" (ligne horizontale) pour eviter le
// chevauchement de 2 plages qui se croisent sur les memes jours.
type RangeLane = { range: MealPlanRange; lane: number };
function assignLanes(ranges: MealPlanRange[], from: string, to: string): RangeLane[] {
  const inWindow = ranges.filter((r) => !(r.dateTo < from || r.dateFrom > to));
  const sorted = [...inWindow].sort((a, b) =>
    a.dateFrom !== b.dateFrom ? (a.dateFrom < b.dateFrom ? -1 : 1) : a.dateTo < b.dateTo ? -1 : 1,
  );
  const laneEnd: string[] = [];
  const out: RangeLane[] = [];
  for (const r of sorted) {
    let lane = laneEnd.findIndex((end) => end < r.dateFrom);
    if (lane === -1) lane = laneEnd.length;
    laneEnd[lane] = r.dateTo;
    out.push({ range: r, lane });
  }
  return out;
}

const MAX_LANES = 3;
const BAND_HEIGHT = 16;
const BAND_GAP = 2;
const BAND_TOP = 22; // espace reserve au numero du jour

export type MonthCalendarProps = {
  /** Mois de reference (string YYYY-MM-DD, n'importe quel jour du mois). */
  month: string;
  ranges: MealPlanRange[];
  width: number;
  onDayPress: (date: string) => void;
};

export const MonthCalendar = memo(function MonthCalendar({
  month,
  ranges,
  width,
  onDayPress,
}: MonthCalendarProps) {
  const theme = useTheme();
  const today = todayIso();

  const cells = useMemo(() => monthGrid(month), [month]);
  const windowFrom = cells[0] as string;
  const windowTo = cells[cells.length - 1] as string;
  const lanes = useMemo(
    () => assignLanes(ranges, windowFrom, windowTo),
    [ranges, windowFrom, windowTo],
  );

  // Segments de bandes par rangee (portion d'une plage dans une rangee de 7 jours)
  type Segment = {
    rangeId: string;
    name: string;
    color: { bg: string; text: string };
    lane: number;
    startCol: number;
    spanCols: number;
  };
  const segmentsForRow = (rowCells: string[]): Segment[] => {
    const rowFrom = rowCells[0] as string;
    const rowTo = rowCells[rowCells.length - 1] as string;
    const out: Segment[] = [];
    for (const { range, lane } of lanes) {
      if (range.dateTo < rowFrom || range.dateFrom > rowTo) continue;
      const segStart = range.dateFrom > rowFrom ? range.dateFrom : rowFrom;
      const segEnd = range.dateTo < rowTo ? range.dateTo : rowTo;
      const startCol = rowCells.indexOf(segStart);
      const endCol = rowCells.indexOf(segEnd);
      if (startCol === -1 || endCol === -1) continue;
      out.push({
        rangeId: range.id,
        name: range.name,
        color: colorForRange(range.name),
        lane,
        startCol,
        spanCols: endCol - startCol + 1,
      });
    }
    return out;
  };

  const colWidth = width / 7;

  return (
    <View style={[styles.root, { width }]}>
      {/* En-tete jours de la semaine */}
      <View style={styles.weekHeader}>
        {WEEKDAYS.map((wd) => (
          <View key={wd} style={styles.weekHeaderCell}>
            <Text style={[styles.weekHeaderText, { color: theme.colors.onSurfaceVariant }]}>
              {WEEKDAY_LABELS[wd].charAt(0)}
            </Text>
          </View>
        ))}
      </View>

      {/* 6 rangees */}
      <View style={styles.grid}>
        {Array.from({ length: 6 }).map((_, rowIdx) => {
          const rowCells = cells.slice(rowIdx * 7, rowIdx * 7 + 7);
          const rowKey = rowCells[0] ?? `row-${rowIdx}`;
          const segments = segmentsForRow(rowCells).filter((s) => s.lane < MAX_LANES);
          return (
            <View key={rowKey} style={styles.row}>
              {/* Cellules cliquables (numero du jour) */}
              {rowCells.map((date) => {
                const inMonth = isSameMonth(date, month);
                const isToday = date === today;
                return (
                  <TouchableOpacity
                    key={date}
                    style={[styles.cell, { borderColor: theme.colors.outlineVariant }]}
                    activeOpacity={0.6}
                    onPress={() => onDayPress(date)}
                  >
                    <View
                      style={[
                        styles.dayNumWrap,
                        isToday && { backgroundColor: theme.colors.primary },
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayNum,
                          {
                            color: isToday
                              ? theme.colors.onPrimary
                              : inMonth
                                ? theme.colors.onSurface
                                : theme.colors.onSurfaceVariant,
                            opacity: inMonth ? 1 : 0.4,
                            fontWeight: isToday ? '800' : '500',
                          },
                        ]}
                      >
                        {Number(date.slice(8, 10))}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}

              {/* Overlay des bandes (continu sur plusieurs cellules) */}
              <View style={styles.bandsOverlay} pointerEvents="none">
                {segments.map((s) => (
                  <View
                    key={`${s.rangeId}-${s.startCol}`}
                    style={{
                      position: 'absolute',
                      left: s.startCol * colWidth + 1,
                      width: s.spanCols * colWidth - 2,
                      top: BAND_TOP + s.lane * (BAND_HEIGHT + BAND_GAP),
                      height: BAND_HEIGHT,
                      backgroundColor: s.color.bg,
                      borderRadius: 3,
                      justifyContent: 'center',
                      paddingHorizontal: 4,
                    }}
                  >
                    <Text numberOfLines={1} style={[styles.bandText, { color: s.color.text }]}>
                      {s.name}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  weekHeader: { flexDirection: 'row', paddingVertical: 6 },
  weekHeaderCell: { flex: 1, alignItems: 'center' },
  weekHeaderText: { fontSize: 12, fontWeight: '700' },
  grid: { flex: 1 },
  row: { flex: 1, flexDirection: 'row', position: 'relative' },
  cell: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 2,
    alignItems: 'center',
  },
  dayNumWrap: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  dayNum: { fontSize: 13 },
  bandsOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  bandText: { fontSize: 10, fontWeight: '700' },
});
