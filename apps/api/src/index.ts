import { HealthResponseSchema } from '@mealendar/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { runScheduledNotifications } from './lib/notificationsScheduler';
import { getServiceClient } from './lib/supabase';
import { dietPlansRouter } from './routes/dietPlans';
import { householdsRouter } from './routes/households';
import { ingredientsRouter } from './routes/ingredients';
import { llmRouter } from './routes/llm';
import { planningsRouter } from './routes/plannings';
import { pushRouter } from './routes/push';
import { recipesRouter } from './routes/recipes';

export type Bindings = {
  APP_VERSION: string;
  CACHE?: KVNamespace; // namespace KV defini dans wrangler.toml
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_JWT_SECRET?: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }),
);

app.get('/', (c) =>
  c.json({
    name: 'mealendar-api',
    version: c.env.APP_VERSION,
    docs: 'https://github.com/anomalyco/mealendar',
  }),
);

app.get('/health', (c) => {
  const payload = HealthResponseSchema.parse({
    status: 'ok',
    service: 'mealendar-api',
    version: c.env.APP_VERSION,
    timestamp: new Date().toISOString(),
  });
  return c.json(payload);
});

// Routes authentifiees
app.route('/api', householdsRouter);
app.route('/api', recipesRouter);
app.route('/api', planningsRouter);
app.route('/api', ingredientsRouter);
app.route('/api', llmRouter);
app.route('/api', dietPlansRouter);
app.route('/api', pushRouter);

app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

app.onError((err, c) => {
  console.error('[api] error', err);
  return c.json({ error: 'internal_error', message: err.message }, 500);
});

/**
 * Export named pour les tests (qui appellent `app.request(...)`).
 */
export { app };

/**
 * Cloudflare Workers : on exporte fetch + scheduled.
 *
 * Le scheduled handler est declenche par les Cron Triggers definis dans
 * wrangler.toml (`triggers.crons`). Il execute le scheduler de notifications
 * qui decide quoi envoyer selon l'heure (20h prepa veille, dimanche 18h courses).
 */
export default {
  fetch: app.fetch,
  async scheduled(
    controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ): Promise<void> {
    console.log(`[cron] scheduled event at ${new Date(controller.scheduledTime).toISOString()}`);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn('[cron] Supabase non configure, skip');
      return;
    }
    ctx.waitUntil(
      (async () => {
        try {
          const sb = getServiceClient(env);
          const outcome = await runScheduledNotifications(sb, new Date(controller.scheduledTime));
          console.log('[cron] outcome', JSON.stringify(outcome));
        } catch (e) {
          console.error('[cron] runScheduledNotifications failed', e);
        }
      })(),
    );
  },
} satisfies ExportedHandler<Bindings>;
