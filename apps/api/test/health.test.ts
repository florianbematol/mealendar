import { describe, expect, it } from 'vitest';
import { app } from '../src/index';

const env = { APP_VERSION: '0.1.0' } as const;

describe('mealendar-api', () => {
  it('GET / returns service info', async () => {
    const res = await app.request('/', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; version: string };
    expect(body.name).toBe('mealendar-api');
    expect(body.version).toBe('0.1.0');
  });

  it('GET /health returns ok payload', async () => {
    const res = await app.request('/health', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      service: string;
      version: string;
      timestamp: string;
    };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('mealendar-api');
    expect(body.version).toBe('0.1.0');
    expect(() => new Date(body.timestamp)).not.toThrow();
  });

  it('GET /unknown returns 404', async () => {
    const res = await app.request('/does-not-exist', {}, env);
    expect(res.status).toBe(404);
  });
});
