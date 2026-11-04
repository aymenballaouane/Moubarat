import { afterAll, describe, expect, it } from 'vitest';
import { setupTestStack, type TestStack } from './helpers.js';

/* Audit multi-centre 22/09/2026 (socle 2e centre, supervision de base) — /ready distingue « vivant »
   (/health) de « prêt à servir avec une latence base acceptable ». */

describe('GET /ready', () => {
  let stack: TestStack | null = null;
  afterAll(async () => { await stack?.teardown(); });

  it('base saine : 200, ready=true, une latence numérique', async () => {
    stack = await setupTestStack();
    const res = await stack.app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ready: boolean; dbLatencyMs: number };
    expect(body.ready).toBe(true);
    expect(body.dbLatencyMs).toBeGreaterThanOrEqual(0);
    expect(body.dbLatencyMs).toBeLessThan(500);
  });
});
