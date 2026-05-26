/**
 * Tests d'integration legers pour runScheduledNotifications.
 *
 * On mock le SupabaseClient pour observer quelles branches sont declenchees
 * selon l'heure/jour Paris, sans toucher la vraie DB ni l'API Expo Push.
 *
 * Note : ce fichier mock un Supabase builder qui doit etre thenable
 * (pattern PostgrestQueryBuilder). La regle noThenProperty est desactivee
 * via overrides biome.json pour les fichiers de test.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as expoPush from '../src/lib/expoPush';
import { runScheduledNotifications } from '../src/lib/notificationsScheduler';

/**
 * Helper : cree un SupabaseClient mock minimal qui retourne des donnees vides
 * sur tous les endpoints utilises par le scheduler.
 */
function makeEmptySupabaseMock(): SupabaseClient {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    not: vi.fn(() => builder),
    is: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    update: vi.fn(() => builder),
    then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
      resolve({ data: [], error: null }),
  };
  return {
    from: vi.fn(() => builder),
  } as any as SupabaseClient;
}

beforeEach(() => {
  // On stub sendExpoPushMessages pour ne JAMAIS appeler le vrai endpoint Expo.
  vi.spyOn(expoPush, 'sendExpoPushMessages').mockResolvedValue([]);
});

describe('runScheduledNotifications', () => {
  it('skip si pas dans la fenetre 20h ni dimanche 18h', async () => {
    const sb = makeEmptySupabaseMock();
    // 2026-01-15 (jeudi) 10h00 UTC -> 11h Paris (CET) -> rien de planifie
    const now = new Date('2026-01-15T10:00:00Z');
    const outcome = await runScheduledNotifications(sb, now);
    expect(outcome.hour).toBe(11);
    expect(outcome.weekday).toBe(4);
    expect(outcome.skipped).toMatch(/nothing scheduled/);
    expect(outcome.nextDayReminders).toBeUndefined();
    expect(outcome.shoppingReminders).toBeUndefined();
  });

  it('declenche nextDayReminders a 20h Paris (un jeudi)', async () => {
    const sb = makeEmptySupabaseMock();
    // Jeudi 2026-01-15 19h UTC = 20h Paris (CET)
    const now = new Date('2026-01-15T19:00:00Z');
    const outcome = await runScheduledNotifications(sb, now);
    expect(outcome.hour).toBe(20);
    expect(outcome.nextDayReminders).toBeDefined();
    expect(outcome.shoppingReminders).toBeUndefined();
  });

  it('declenche les deux a dimanche 20h Paris (impossible vu cron 18h, mais sanity)', async () => {
    const sb = makeEmptySupabaseMock();
    // Dimanche 2026-01-18 19h UTC = 20h Paris
    const now = new Date('2026-01-18T19:00:00Z');
    const outcome = await runScheduledNotifications(sb, now);
    expect(outcome.hour).toBe(20);
    expect(outcome.weekday).toBe(0);
    expect(outcome.nextDayReminders).toBeDefined();
    // 18h declenche shopping, 20h declenche nextDay -> ici on est a 20h
    // donc seuls les nextDay sont declenches.
    expect(outcome.shoppingReminders).toBeUndefined();
  });

  it('declenche shoppingReminders a dimanche 18h Paris', async () => {
    const sb = makeEmptySupabaseMock();
    // Dimanche 2026-01-18 17h UTC = 18h Paris (CET)
    const now = new Date('2026-01-18T17:00:00Z');
    const outcome = await runScheduledNotifications(sb, now);
    expect(outcome.hour).toBe(18);
    expect(outcome.weekday).toBe(0);
    expect(outcome.shoppingReminders).toBeDefined();
    expect(outcome.nextDayReminders).toBeUndefined();
  });

  it("avec foyer vide : 0 envoye, pas d'erreur", async () => {
    const sb = makeEmptySupabaseMock();
    const now = new Date('2026-01-15T19:00:00Z');
    const outcome = await runScheduledNotifications(sb, now);
    expect(outcome.nextDayReminders?.sent).toBe(0);
    expect(outcome.nextDayReminders?.invalidTokens).toBe(0);
  });
});
