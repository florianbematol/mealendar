/**
 * Helpers de date pour le planning. On manipule des string YYYY-MM-DD
 * (timezone-safe : pas de Date conversion sauf pour les calculs).
 */

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Lundi',
  tuesday: 'Mardi',
  wednesday: 'Mercredi',
  thursday: 'Jeudi',
  friday: 'Vendredi',
  saturday: 'Samedi',
  sunday: 'Dimanche',
};

export function todayIso(): string {
  const d = new Date();
  return toIsoDate(d);
}

export function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function fromIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map((p) => Number.parseInt(p, 10));
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

export function addDays(s: string, n: number): string {
  const d = fromIsoDate(s);
  d.setDate(d.getDate() + n);
  return toIsoDate(d);
}

export function weekdayOf(s: string): Weekday {
  const d = fromIsoDate(s);
  // getDay() : 0 = dimanche, 1 = lundi, ..., 6 = samedi
  const idx = (d.getDay() + 6) % 7; // ramene a 0 = lundi
  return WEEKDAYS[idx] ?? 'monday';
}

export function startOfWeek(s: string): string {
  const wd = weekdayOf(s);
  const idx = WEEKDAYS.indexOf(wd);
  return addDays(s, -idx);
}

export function rangeDates(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cur = startDate;
  while (cur <= endDate) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function formatShortDate(s: string): string {
  const d = fromIsoDate(s);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Format long e.g. "Lundi 1 fevrier 2026" (utile pour ecran jour).
 */
const FR_MONTHS = [
  'janvier',
  'fevrier',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'aout',
  'septembre',
  'octobre',
  'novembre',
  'decembre',
];
export function formatLongDate(s: string): string {
  const d = fromIsoDate(s);
  const wd = weekdayOf(s);
  const wdLabel = WEEKDAY_LABELS[wd];
  return `${wdLabel} ${d.getDate()} ${FR_MONTHS[d.getMonth()] ?? ''} ${d.getFullYear()}`;
}

export function formatMonthYear(s: string): string {
  const d = fromIsoDate(s);
  return `${(FR_MONTHS[d.getMonth()] ?? '').replace(/^./, (c) => c.toUpperCase())} ${d.getFullYear()}`;
}

/**
 * Premier jour du mois (string YYYY-MM-01).
 */
export function startOfMonth(s: string): string {
  const d = fromIsoDate(s);
  return toIsoDate(new Date(d.getFullYear(), d.getMonth(), 1));
}

/**
 * Dernier jour du mois.
 */
export function endOfMonth(s: string): string {
  const d = fromIsoDate(s);
  return toIsoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/**
 * Decale d'un mois (peut etre negatif).
 */
export function addMonths(s: string, n: number): string {
  const d = fromIsoDate(s);
  d.setMonth(d.getMonth() + n);
  return toIsoDate(d);
}

/**
 * Renvoie la grille de 6 semaines (42 cases) couvrant le mois de `s`,
 * en alignant sur le lundi (peut deborder sur le mois precedent et suivant).
 * Chaque case = string YYYY-MM-DD.
 */
export function monthGrid(s: string): string[] {
  const first = startOfMonth(s);
  const wd = weekdayOf(first);
  const idx = WEEKDAYS.indexOf(wd); // 0 = lundi
  const gridStart = addDays(first, -idx);
  const cells: string[] = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
  return cells;
}

/**
 * Renvoie true si `s` appartient au mois de `ref` (utile pour griser les
 * cases hors mois courant dans la grille).
 */
export function isSameMonth(s: string, ref: string): boolean {
  const a = fromIsoDate(s);
  const b = fromIsoDate(ref);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * Renvoie les 7 dates de la semaine de `s` (lundi -> dimanche).
 */
export function weekDates(s: string): string[] {
  const start = startOfWeek(s);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
