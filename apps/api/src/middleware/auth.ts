import type { Context, MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import type { Bindings } from '../index';

export type AuthContext = {
  userId: string;
  email: string | undefined;
  accessToken: string;
};

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

/**
 * Cache des JWKS Supabase par projet, partage entre requetes (au sein d'un meme isolate Workers).
 * Le JWKS Supabase est expose a `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`.
 *
 * Note : `createRemoteJWKSet` integre son propre cache + cooldown ; on le wrappe
 * juste pour ne le construire qu'une fois par projet.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(supabaseUrl: string) {
  const cached = jwksCache.get(supabaseUrl);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
  jwksCache.set(supabaseUrl, jwks);
  return jwks;
}

/**
 * Middleware Hono qui valide un JWT Supabase.
 *
 * Supporte les deux schemas de signature :
 *  - HS256 (legacy / "JWT Secret" dans Settings > API)            -> SUPABASE_JWT_SECRET
 *  - ES256 / RS256 (asymetrique, default sur les projets recents) -> JWKS distant
 *
 * En cas de succes, expose c.get('auth') = { userId, email, accessToken }.
 */
export function requireAuth(): MiddlewareHandler<{ Bindings: Bindings }> {
  return async (c, next) => {
    const header = c.req.header('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return c.json({ error: 'unauthorized', message: 'Missing Bearer token' }, 401);
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      return c.json({ error: 'unauthorized', message: 'Empty token' }, 401);
    }

    let alg: string;
    try {
      alg = decodeProtectedHeader(token).alg ?? '';
    } catch {
      return c.json({ error: 'unauthorized', message: 'Malformed token' }, 401);
    }

    try {
      let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];

      if (alg === 'HS256') {
        const secret = c.env.SUPABASE_JWT_SECRET;
        if (!secret) {
          console.error('[auth] SUPABASE_JWT_SECRET not configured for HS256 token');
          return c.json({ error: 'server_misconfigured' }, 500);
        }
        ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
          algorithms: ['HS256'],
        }));
      } else if (alg === 'ES256' || alg === 'RS256') {
        const supabaseUrl = c.env.SUPABASE_URL;
        if (!supabaseUrl) {
          console.error('[auth] SUPABASE_URL not configured for asymmetric token');
          return c.json({ error: 'server_misconfigured' }, 500);
        }
        const jwks = getJwks(supabaseUrl);
        ({ payload } = await jwtVerify(token, jwks, {
          algorithms: ['ES256', 'RS256'],
        }));
      } else {
        return c.json({ error: 'unauthorized', message: `Unsupported alg: ${alg}` }, 401);
      }

      const userId = payload.sub;
      if (!userId) {
        return c.json({ error: 'unauthorized', message: 'Token has no subject' }, 401);
      }
      c.set('auth', {
        userId,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        accessToken: token,
      });
      await next();
    } catch (err) {
      console.warn('[auth] JWT verification failed', err);
      return c.json({ error: 'unauthorized', message: 'Invalid or expired token' }, 401);
    }
  };
}

export function getAuth(c: Context): AuthContext {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth) {
    throw new Error('getAuth called without requireAuth middleware');
  }
  return auth;
}
