/**
 * Generation d'un fichier ICS (RFC 5545) a partir d'un planning + repas + recettes.
 *
 * Chaque planned_meal est un VEVENT all-day-style ou avec heure si le slot
 * a une heure dans slot_config. Pour rester simple en l'absence d'heure :
 *  - breakfast : 08:00, lunch : 12:30, snack : 16:30, dinner : 19:30
 *  - duree par defaut : 30min (breakfast/snack) / 60min (lunch/dinner)
 */

const DEFAULT_TIMES: Record<string, { start: string; durationMin: number }> = {
  breakfast: { start: '08:00', durationMin: 30 },
  lunch: { start: '12:30', durationMin: 60 },
  snack: { start: '16:30', durationMin: 20 },
  dinner: { start: '19:30', durationMin: 60 },
};

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function formatDateTime(date: string, time: string): string {
  // ISO sans tirets ni colon : YYYYMMDDTHHMMSS
  const [y, m, d] = date.split('-');
  const [hh, mm] = time.split(':');
  return `${y}${m}${d}T${hh}${mm}00`;
}

function addMinutes(dateStr: string, time: string, mins: number): { date: string; time: string } {
  const [y, m, d] = dateStr.split('-').map((p) => Number.parseInt(p, 10));
  const [hh, mm] = time.split(':').map((p) => Number.parseInt(p, 10));
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0));
  dt.setUTCMinutes(dt.getUTCMinutes() + mins);
  const yyyy = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const da = String(dt.getUTCDate()).padStart(2, '0');
  const ho = String(dt.getUTCHours()).padStart(2, '0');
  const mi = String(dt.getUTCMinutes()).padStart(2, '0');
  return { date: `${yyyy}-${mo}-${da}`, time: `${ho}:${mi}` };
}

export type IcsEvent = {
  uid: string;
  date: string; // YYYY-MM-DD
  slotKey: string;
  title: string;
  description?: string | null;
  /** Heure custom au format HH:MM (sinon DEFAULT_TIMES) */
  startTime?: string;
};

export function buildIcs(opts: {
  calendarName: string;
  events: IcsEvent[];
}): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mealendar//FR',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
  ];

  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(
    now.getUTCDate(),
  ).padStart(2, '0')}T${String(now.getUTCHours()).padStart(2, '0')}${String(
    now.getUTCMinutes(),
  ).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}Z`;

  for (const ev of opts.events) {
    const slot = DEFAULT_TIMES[ev.slotKey] ?? { start: '12:00', durationMin: 60 };
    const startTime = ev.startTime ?? slot.start;
    const end = addMinutes(ev.date, startTime, slot.durationMin);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.uid}@mealendar`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${formatDateTime(ev.date, startTime)}`);
    lines.push(`DTEND:${formatDateTime(end.date, end.time)}`);
    lines.push(`SUMMARY:${escapeText(ev.title)}`);
    if (ev.description) {
      lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    }
    lines.push(`CATEGORIES:Mealendar,${ev.slotKey}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
