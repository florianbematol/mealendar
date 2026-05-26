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
