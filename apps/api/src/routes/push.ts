/**
 * Endpoints pour les push notifications (Phase 5.4).
 *
 *  - POST   /api/me/push-tokens          : enregistre un token Expo
 *  - POST   /api/me/push-tokens/test     : envoie un push de test au user
 *  - DELETE /api/me/push-tokens/:token   : supprime un token (logout, opt-out)
 *  - PUT    /api/me/push-enabled         : active/desactive globalement
 */
import { RegisterPushTokenInputSchema, SetPushEnabledInputSchema } from '@mealendar/shared';
import { Hono } from 'hono';
import type { Bindings } from '../index';
import { sendExpoPushMessages } from '../lib/expoPush';
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
// POST /api/me/push-tokens/test : envoie un push de test au user courant
//
// Utile pour valider qu'un device est correctement enregistre. Cherche tous
// les tokens actifs du user, envoie une notification simple, et retourne le
// nombre de messages envoyes + tokens marques invalides.
// ============================================================================
pushRouter.post('/me/push-tokens/test', async (c) => {
  const auth = getAuth(c);
  const sb = getUserClient(c.env, auth.accessToken);

  const { data: tokens, error } = await sb
    .from('device_tokens')
    .select('expo_push_token')
    .eq('enabled', true)
    .is('invalid_at', null);
  if (error) {
    return c.json({ error: 'db_error', message: error.message }, 500);
  }
  type Row = { expo_push_token: string };
  const list = (tokens ?? []) as unknown as Row[];
  if (list.length === 0) {
    return c.json(
      {
        error: 'no_tokens',
        message: 'Aucun device enregistre pour ce compte. Verifiez les permissions notifications.',
      },
      404,
    );
  }

  const messages = list.map((t) => ({
    to: t.expo_push_token,
    title: '🍽 Mealendar',
    body: 'Notification de test envoyee depuis votre compte.',
    sound: 'default' as const,
    channelId: 'default',
    data: { type: 'test', sentAt: new Date().toISOString() },
  }));

  try {
    const tickets = await sendExpoPushMessages(messages);
    const errors = tickets.filter((t) => t.status === 'error').length;
    return c.json({ ok: true, sent: tickets.length, errors });
  } catch (e) {
    return c.json({ error: 'expo_push_failed', message: (e as Error).message }, 502);
  }
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
