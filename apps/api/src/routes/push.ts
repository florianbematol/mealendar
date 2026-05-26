/**
 * Endpoints pour les push notifications (Phase 5.4).
 *
 *  - POST   /api/me/push-tokens          : enregistre un token Expo
 *  - DELETE /api/me/push-tokens/:token   : supprime un token (logout, opt-out)
 *  - PUT    /api/me/push-enabled         : active/desactive globalement
 */
import { RegisterPushTokenInputSchema, SetPushEnabledInputSchema } from '@mealendar/shared';
import { Hono } from 'hono';
import type { Bindings } from '../index';
import { getUserClient } from '../lib/supabase';
import { getAuth, requireAuth } from '../middleware/auth';

export const pushRouter = new Hono<{ Bindings: Bindings }>();

pushRouter.use('*', requireAuth());

// ============================================================================
// POST /api/me/push-tokens : upsert d'un token Expo pour le user courant
// ============================================================================
pushRouter.post('/me/push-tokens', async (c) => {
  const auth = getAuth(c);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = RegisterPushTokenInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const sb = getUserClient(c.env, auth.accessToken);
  const { data, error } = await sb.rpc('register_push_token', {
    p_token: parsed.data.token,
    p_platform: parsed.data.platform,
  });
  if (error) {
    console.error('[push] register failed', error);
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json({ ok: true, id: (data as { id?: string } | null)?.id ?? null });
});

// ============================================================================
// DELETE /api/me/push-tokens/:token : supprime un token (logout)
// ============================================================================
pushRouter.delete('/me/push-tokens/:token', async (c) => {
  const auth = getAuth(c);
  const token = c.req.param('token');
  if (!token) return c.json({ error: 'missing_token' }, 400);

  const sb = getUserClient(c.env, auth.accessToken);
  const { error } = await sb.rpc('unregister_push_token', { p_token: token });
  if (error) {
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json({ ok: true });
});

// ============================================================================
// PUT /api/me/push-enabled : active/desactive globalement les notifs du user
// ============================================================================
pushRouter.put('/me/push-enabled', async (c) => {
  const auth = getAuth(c);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = SetPushEnabledInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
  }
  const sb = getUserClient(c.env, auth.accessToken);
  const { error } = await sb.rpc('set_push_notifications_enabled', {
    p_enabled: parsed.data.enabled,
  });
  if (error) {
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  return c.json({ ok: true });
});
