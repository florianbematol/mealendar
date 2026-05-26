/**
 * Tests pour le router admin : authentification par X-Admin-Token + endpoint
 * scheduler/run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import * as expoPush from '../src/lib/expoPush';
import * as supabaseLib from '../src/lib/supabase';

const ADMIN_TOKEN = 'test-admin-secret';

const baseEnv = {
  APP_VERSION: '0.1.0',
  ADMIN_TOKEN,
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'srv-key',
  SUPABASE_JWT_SECRET: 'jwt-secret-with-enough-entropy-1234567890',
} as const;

/** Mock Supabase client minimal qui renvoie data: [] partout. */
function makeFakeServiceClient() {
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
  return { from: vi.fn(() => builder) };
}

beforeEach(() => {
  // Stub sendExpoPushMessages pour ne JAMAIS toucher l'API Expo en CI.
  vi.spyOn(expoPush, 'sendExpoPushMessages').mockResolvedValue([]);
  // Stub getServiceClient pour eviter de creer un vrai client Supabase qui
  // tenterait des requetes HTTP vers https://test.supabase.co.
  vi.spyOn(supabaseLib, 'getServiceClient').mockReturnValue(makeFakeServiceClient() as any);
});

describe('admin router', () => {
  it('returns 503 if ADMIN_TOKEN is not configured', async () => {
    const res = await app.request(
      '/api/admin/scheduler/run',
      { method: 'POST' },
      { ...baseEnv, ADMIN_TOKEN: undefined },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('admin_disabled');
  });

  it('returns 403 if X-Admin-Token mismatches', async () => {
    const res = await app.request(
      '/api/admin/scheduler/run',
      {
        method: 'POST',
        headers: { 'X-Admin-Token': 'wrong-token' },
      },
      baseEnv,
    );
    expect(res.status).toBe(403);
  });

  it('returns 503 if Supabase not configured', async () => {
    const res = await app.request(
      '/api/admin/scheduler/run',
      {
        method: 'POST',
        headers: { 'X-Admin-Token': ADMIN_TOKEN },
      },
      { ...baseEnv, SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined },
    );
    expect(res.status).toBe(503);
  });

  it('returns 400 if `now` is not a valid date', async () => {
    const res = await app.request(
      '/api/admin/scheduler/run',
      {
        method: 'POST',
        headers: { 'X-Admin-Token': ADMIN_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ now: 'not-a-date' }),
      },
      baseEnv,
    );
    expect(res.status).toBe(400);
  });

  it('runs scheduler with given `now` and returns outcome', async () => {
    // 2026-01-15 10:00 UTC = 11h Paris (CET) -> rien a envoyer
    const res = await app.request(
      '/api/admin/scheduler/run',
      {
        method: 'POST',
        headers: { 'X-Admin-Token': ADMIN_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ now: '2026-01-15T10:00:00Z' }),
      },
      baseEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      outcome: { hour: number; weekday: number; skipped?: string };
    };
    expect(body.ok).toBe(true);
    expect(body.outcome.hour).toBe(11);
    expect(body.outcome.weekday).toBe(4);
    expect(body.outcome.skipped).toBeDefined();
  });
});
