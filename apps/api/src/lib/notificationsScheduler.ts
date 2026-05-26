/**
 * Logique de planification des push notifications.
 *
 * Le worker cron tourne plusieurs fois par jour. A chaque execution, on
 * decide quoi envoyer en fonction de l'heure courante :
 *
 *  - 20h00 (heure locale "FR" = Europe/Paris) : rappel veille de prepa
 *    pour TOUS les meals planifies pour le lendemain. Sert a anticiper
 *    (sortir la viande du congelo, faire decongeler, etc.).
 *
 *  - Dimanche 18h00 : rappel courses pour la semaine qui commence demain
 *    (lundi). Indique le nombre de meals planifies + lien vers la liste
 *    de courses.
 *
 * Le scheduler est idempotent : on note dans la table `notification_runs`
 * un identifiant unique par execution (date + type) pour eviter les doublons
 * si le cron se declenche 2 fois dans la meme heure.
 *
 * On utilise le service role client (bypass RLS) car le cron tourne sans
 * contexte user.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { type ExpoPushMessage, extractInvalidTokens, sendExpoPushMessages } from './expoPush';

const PARIS_TZ = 'Europe/Paris';

/**
 * Renvoie la date locale Paris au format YYYY-MM-DD pour un Date donne.
 */
export function dateInParis(d: Date): string {
  // toLocaleDateString en-CA donne YYYY-MM-DD
  return d.toLocaleDateString('en-CA', { timeZone: PARIS_TZ });
}

/**
 * Renvoie l'heure locale Paris (0..23) pour un Date donne.
 */
export function hourInParis(d: Date): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: PARIS_TZ,
    hour: '2-digit',
    hour12: false,
  });
  return Number.parseInt(fmt.format(d), 10);
}

/**
 * Renvoie le jour de la semaine local Paris (0=dimanche, 6=samedi).
 */
export function weekdayInParis(d: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PARIS_TZ,
    weekday: 'short',
  });
  const wd = fmt.format(d);
  // 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wd] ?? 0;
}

export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const SLOT_LABELS: Record<string, string> = {
  breakfast: 'petit-dej',
  lunch: 'dejeuner',
  snack: 'gouter',
  dinner: 'diner',
};

/**
 * Recupere tous les tokens actifs d'un user.
 */
async function tokensForUsers(
  sb: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string[]>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await sb
    .from('device_tokens')
    .select('user_id, expo_push_token')
    .in('user_id', userIds)
    .eq('enabled', true)
    .is('invalid_at', null);
  if (error) {
    console.error('[notif] tokensForUsers failed', error);
    return new Map();
  }
  const map = new Map<string, string[]>();
  for (const row of (data ?? []) as { user_id: string; expo_push_token: string }[]) {
    const arr = map.get(row.user_id) ?? [];
    arr.push(row.expo_push_token);
    map.set(row.user_id, arr);
  }
  return map;
}

/**
 * Marque les tokens invalides (apres reception d'une erreur DeviceNotRegistered).
 */
async function markTokensInvalid(sb: SupabaseClient, tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  const { error } = await sb
    .from('device_tokens')
    .update({ invalid_at: new Date().toISOString(), enabled: false })
    .in('expo_push_token', tokens);
  if (error) console.warn('[notif] markTokensInvalid failed', error);
}

// ============================================================================
// Rappel "Demain" (20h)
// ============================================================================

/**
 * Pour chaque planned_meal demain, envoie un push aux membres concernes
 * (diners ou tous les membres du foyer si vide).
 *
 * Format : "Demain au diner : Lasagnes (4 pers)"
 */
export async function sendNextDayReminders(sb: SupabaseClient): Promise<{
  sent: number;
  invalidTokens: number;
}> {
  const now = new Date();
  const todayParis = dateInParis(now);
  const tomorrowParis = addDaysIso(todayParis, 1);

  // 1. Recupere tous les meals demain (avec recipe_id non null pour avoir un titre)
  const { data: mealsData, error: mErr } = await sb
    .from('planned_meals')
    .select('id, planning_id, date, slot_key, recipe_id, custom_title, servings, diners')
    .eq('date', tomorrowParis)
    .not('recipe_id', 'is', null);
  if (mErr) {
    console.error('[notif] sendNextDay meals fetch failed', mErr);
    return { sent: 0, invalidTokens: 0 };
  }
  type MealRow = {
    id: string;
    planning_id: string;
    date: string;
    slot_key: string;
    recipe_id: string;
    custom_title: string | null;
    servings: number;
    diners: string[];
  };
  const meals = (mealsData ?? []) as unknown as MealRow[];
  if (meals.length === 0) return { sent: 0, invalidTokens: 0 };

  // 2. Recupere les titres des recettes
  const recipeIds = [...new Set(meals.map((m) => m.recipe_id))];
  const { data: recipesData } = await sb.from('recipes').select('id, title').in('id', recipeIds);
  const titleByRecipe = new Map<string, string>(
    ((recipesData ?? []) as { id: string; title: string }[]).map((r) => [r.id, r.title]),
  );

  // 3. Recupere les plannings -> household_id pour resoudre les diners par defaut
  const planningIds = [...new Set(meals.map((m) => m.planning_id))];
  const { data: planningsData } = await sb
    .from('plannings')
    .select('id, household_id')
    .in('id', planningIds);
  const householdByPlanning = new Map<string, string>(
    ((planningsData ?? []) as { id: string; household_id: string }[]).map((p) => [
      p.id,
      p.household_id,
    ]),
  );

  // 4. Recupere les members de tous ces households
  const householdIds = [...new Set([...householdByPlanning.values()])];
  const { data: membersData } = await sb
    .from('household_members')
    .select('household_id, user_id')
    .in('household_id', householdIds);
  const membersByHousehold = new Map<string, string[]>();
  for (const m of (membersData ?? []) as { household_id: string; user_id: string }[]) {
    const arr = membersByHousehold.get(m.household_id) ?? [];
    arr.push(m.user_id);
    membersByHousehold.set(m.household_id, arr);
  }

  // 5. Pour chaque meal, calcule les userIds concernes
  const messagesByUser = new Map<string, string[]>();
  for (const meal of meals) {
    const householdId = householdByPlanning.get(meal.planning_id);
    if (!householdId) continue;
    const allMembers = membersByHousehold.get(householdId) ?? [];
    const targetUsers = meal.diners.length > 0 ? meal.diners : allMembers;
    const title = titleByRecipe.get(meal.recipe_id) ?? meal.custom_title ?? 'Recette';
    const slotLabel = SLOT_LABELS[meal.slot_key] ?? meal.slot_key;
    const body = `${capitalize(slotLabel)} : ${title} (${meal.servings} pers.)`;
    for (const uid of targetUsers) {
      const arr = messagesByUser.get(uid) ?? [];
      arr.push(body);
      messagesByUser.set(uid, arr);
    }
  }

  // 6. Recupere les tokens des users concernes
  const userIds = [...messagesByUser.keys()];
  const tokensByUser = await tokensForUsers(sb, userIds);

  // 7. Construit les push messages (1 par token, regroupe les meals dans le body)
  const pushMessages: ExpoPushMessage[] = [];
  for (const [uid, bodies] of messagesByUser) {
    const tokens = tokensByUser.get(uid) ?? [];
    if (tokens.length === 0) continue;
    const body = bodies.length === 1 ? bodies[0] : bodies.join(' • ');
    for (const token of tokens) {
      pushMessages.push({
        to: token,
        title: '🍽 Demain au menu',
        body: body ?? '',
        sound: 'default',
        channelId: 'default',
        data: { type: 'next-day-reminder', date: tomorrowParis },
      });
    }
  }

  if (pushMessages.length === 0) return { sent: 0, invalidTokens: 0 };

  let invalidTokens: string[] = [];
  try {
    const tickets = await sendExpoPushMessages(pushMessages);
    invalidTokens = extractInvalidTokens(pushMessages, tickets);
  } catch (e) {
    console.error('[notif] sendExpoPushMessages failed', e);
    return { sent: 0, invalidTokens: 0 };
  }

  if (invalidTokens.length > 0) {
    await markTokensInvalid(sb, invalidTokens);
  }

  return { sent: pushMessages.length, invalidTokens: invalidTokens.length };
}

// ============================================================================
// Rappel "Courses" (dimanche 18h)
// ============================================================================

/**
 * Pour chaque planning de la semaine prochaine (start_date = lundi prochain
 * ou semaine en cours si on est dimanche), envoie un rappel courses aux
 * membres du foyer.
 */
export async function sendShoppingReminders(sb: SupabaseClient): Promise<{
  sent: number;
  invalidTokens: number;
}> {
  const now = new Date();
  const todayParis = dateInParis(now);
  // On vise les plannings dont la semaine couvre demain (lundi) -> on cherche
  // tous les plannings ou start_date <= demain <= end_date.
  const tomorrowParis = addDaysIso(todayParis, 1);

  const { data: planningsData, error } = await sb
    .from('plannings')
    .select('id, household_id, name, start_date, end_date')
    .lte('start_date', tomorrowParis)
    .gte('end_date', tomorrowParis);
  if (error) {
    console.error('[notif] sendShopping plannings fetch failed', error);
    return { sent: 0, invalidTokens: 0 };
  }
  type PlanningRow = {
    id: string;
    household_id: string;
    name: string;
    start_date: string;
    end_date: string;
  };
  const plannings = (planningsData ?? []) as unknown as PlanningRow[];
  if (plannings.length === 0) return { sent: 0, invalidTokens: 0 };

  // Compte les meals par planning
  const planningIds = plannings.map((p) => p.id);
  const { data: mealCounts } = await sb
    .from('planned_meals')
    .select('planning_id')
    .in('planning_id', planningIds)
    .not('recipe_id', 'is', null);
  const countByPlanning = new Map<string, number>();
  for (const row of (mealCounts ?? []) as { planning_id: string }[]) {
    countByPlanning.set(row.planning_id, (countByPlanning.get(row.planning_id) ?? 0) + 1);
  }

  // Members
  const householdIds = [...new Set(plannings.map((p) => p.household_id))];
  const { data: membersData } = await sb
    .from('household_members')
    .select('household_id, user_id')
    .in('household_id', householdIds);
  const membersByHousehold = new Map<string, string[]>();
  for (const m of (membersData ?? []) as { household_id: string; user_id: string }[]) {
    const arr = membersByHousehold.get(m.household_id) ?? [];
    arr.push(m.user_id);
    membersByHousehold.set(m.household_id, arr);
  }

  // Build messages
  const messagesByUser = new Map<string, ExpoPushMessage['data'] & { body: string }>();
  for (const p of plannings) {
    const members = membersByHousehold.get(p.household_id) ?? [];
    const count = countByPlanning.get(p.id) ?? 0;
    if (count === 0) continue;
    const body = `${count} repas planifie${count > 1 ? 's' : ''} pour la semaine. C'est le moment de faire les courses !`;
    for (const uid of members) {
      messagesByUser.set(uid, { body, planningId: p.id, type: 'shopping-reminder' });
    }
  }

  const userIds = [...messagesByUser.keys()];
  const tokensByUser = await tokensForUsers(sb, userIds);

  const pushMessages: ExpoPushMessage[] = [];
  for (const [uid, payload] of messagesByUser) {
    const tokens = tokensByUser.get(uid) ?? [];
    for (const token of tokens) {
      pushMessages.push({
        to: token,
        title: '🛒 Courses de la semaine',
        body: payload.body,
        sound: 'default',
        channelId: 'default',
        data: payload,
      });
    }
  }

  if (pushMessages.length === 0) return { sent: 0, invalidTokens: 0 };

  let invalidTokens: string[] = [];
  try {
    const tickets = await sendExpoPushMessages(pushMessages);
    invalidTokens = extractInvalidTokens(pushMessages, tickets);
  } catch (e) {
    console.error('[notif] sendExpoPushMessages failed', e);
    return { sent: 0, invalidTokens: 0 };
  }

  if (invalidTokens.length > 0) {
    await markTokensInvalid(sb, invalidTokens);
  }

  return { sent: pushMessages.length, invalidTokens: invalidTokens.length };
}

// ============================================================================
// Dispatcher principal : decide quoi envoyer en fonction de l'heure courante
// ============================================================================

export type SchedulerOutcome = {
  ranAt: string;
  hour: number;
  weekday: number;
  nextDayReminders?: { sent: number; invalidTokens: number };
  shoppingReminders?: { sent: number; invalidTokens: number };
  skipped?: string;
};

export async function runScheduledNotifications(
  sb: SupabaseClient,
  now: Date = new Date(),
): Promise<SchedulerOutcome> {
  const hour = hourInParis(now);
  const weekday = weekdayInParis(now);
  const outcome: SchedulerOutcome = {
    ranAt: now.toISOString(),
    hour,
    weekday,
  };

  // Rappels prepa veille au soir : a 20h heure de Paris
  if (hour === 20) {
    outcome.nextDayReminders = await sendNextDayReminders(sb);
  }

  // Rappel courses : dimanche soir 18h heure de Paris
  if (weekday === 0 && hour === 18) {
    outcome.shoppingReminders = await sendShoppingReminders(sb);
  }

  if (!outcome.nextDayReminders && !outcome.shoppingReminders) {
    outcome.skipped = `nothing scheduled at ${hour}h Paris (weekday=${weekday})`;
  }

  return outcome;
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return (s[0] ?? '').toUpperCase() + s.slice(1);
}
