import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { app } from '../src/index';

const JWT_SECRET = 'test-secret-with-enough-entropy-1234567890';
const env = {
  APP_VERSION: '0.1.0',
  SUPABASE_JWT_SECRET: JWT_SECRET,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
} as const;

async function makeToken(opts: { sub: string; expSeconds?: number; email?: string }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (opts.expSeconds ?? 3600);
  return await new SignJWT({ email: opts.email ?? 'test@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(opts.sub)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(JWT_SECRET));
}

describe('auth middleware', () => {
  it('rejects when no Authorization header', async () => {
    const res = await app.request('/api/me', {}, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unauthorized');
  });

  it('rejects when token is invalid', async () => {
    const res = await app.request(
      '/api/me',
      { headers: { Authorization: 'Bearer not-a-jwt' } },
      env,
    );
    expect(res.status).toBe(401);
  });

  it('rejects when token is expired', async () => {
    const token = await makeToken({ sub: 'user-1', expSeconds: -10 });
    const res = await app.request(
      '/api/me',
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    expect(res.status).toBe(401);
  });

  it('returns 500 if SUPABASE_JWT_SECRET is missing for an HS256 token', async () => {
    const token = await makeToken({ sub: 'user-1' });
    const res = await app.request(
      '/api/me',
      { headers: { Authorization: `Bearer ${token}` } },
      { ...env, SUPABASE_JWT_SECRET: undefined },
    );
    expect(res.status).toBe(500);
  });

  // Note : un test "happy path" complet sur /api/me necessiterait de mocker
  // Supabase. On le couvrira dans des tests d'integration plus tard.
  // Idem pour les tokens ES256/RS256 (necessite JWKS).
});
