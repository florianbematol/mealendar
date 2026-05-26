/**
 * Endpoints admin (Phase 5.4 + ops).
 *
 * Tous les endpoints admin requierent un header `X-Admin-Token` qui doit
 * matcher la variable d'env ADMIN_TOKEN. C'est une protection minimale pour
 * eviter les abus, mais ces endpoints ne doivent JAMAIS etre exposes en prod
 * sans audit.
 *
 *  - POST /api/admin/scheduler/run : declenche le scheduler de notifs
 */
import { Hono } from 'hono';
import type { Bindings } from '../index';
import { runScheduledNotifications } from '../lib/notificationsScheduler';
import { getServiceClient } from '../lib/supabase';

export const adminRouter = new Hono<{ Bindings: Bindings }>();

/**
 * Middleware : verifie le X-Admin-Token. Restreint au path /admin/* uniquement
 * pour ne pas leak vers les autres routers montes sur le meme prefix /api.
 *
 * Si ADMIN_TOKEN n'est pas configure cote serveur, l'endpoint est inaccessible
 * (return 503 immediat).
 */
adminRouter.use('/admin/*', async (c, next) => {
  const expected = c.env.ADMIN_TOKEN;
  if (!expected) {
    return c.json(
      {
        error: 'admin_disabled',
        message: 'ADMIN_TOKEN non configure cote serveur.',
      },
      503,
    );
  }
  const provided = c.req.header('x-admin-token');
  if (provided !== expected) {
    return c.json({ error: 'forbidden' }, 403);
  }
  await next();
});

// ============================================================================
// POST /api/admin/scheduler/run : trigger manuel du scheduler
//
// Body optionnel : { now: '2026-01-15T19:00:00Z' } pour simuler une heure
// donnee (utile pour tester les branches sans attendre le cron).
// ============================================================================
adminRouter.post('/admin/scheduler/run', async (c) => {
  if (!c.env.SUPABASE_URL || !c.env.SUPABASE_SERVICE_ROLE_KEY) {
    return c.json({ error: 'supabase_not_configured' }, 503);
  }

  let body: { now?: string } = {};
  try {
    body = await c.req.json<{ now?: string }>();
  } catch {
    // body optionnel
  }

  const now = body.now ? new Date(body.now) : new Date();
  if (Number.isNaN(now.getTime())) {
    return c.json({ error: 'invalid_now', message: 'now must be ISO date' }, 400);
  }

  try {
    const sb = getServiceClient(c.env);
    const outcome = await runScheduledNotifications(sb, now);
    return c.json({ ok: true, outcome });
  } catch (e) {
    return c.json({ error: 'scheduler_failed', message: (e as Error).message }, 500);
  }
});
