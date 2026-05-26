/**
 * Convertit une valeur Postgres timestamp (avec espace, sans T, sans Z parfois)
 * en ISO 8601 strict (`2026-05-23T09:45:50.764Z`).
 *
 * Postgres retourne par defaut "2026-05-23 09:45:50.764+00" pour un timestamptz,
 * que Zod `z.string().datetime()` rejette. On normalise via `new Date(...).toISOString()`.
 *
 * Si la valeur est deja un objet Date (cas de certains drivers), on l'accepte aussi.
 */
export function toIsoString(input: string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date input: ${String(input)}`);
  }
  return d.toISOString();
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Renvoie le nom anglais du jour (lundi -> "monday") pour une date YYYY-MM-DD.
 * On utilise UTC pour eviter les decalages de fuseau (la date est juste un jour calendaire).
 */
export function weekdayOf(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return WEEKDAYS[d.getUTCDay()] ?? 'monday';
}

/**
 * Genere la liste des dates [start..end] inclusives au format YYYY-MM-DD.
 */
export function rangeDates(start: string, end: string): string[] {
  const out: string[] = [];
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  for (let d = startDate; d.getTime() <= endDate.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
