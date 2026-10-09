import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';

describe('Backend API Skeleton & Health Endpoints', () => {
  const app = createApp();

  it('validates env configuration loader with defaults', () => {
    expect(env.APP_TIMEZONE).toBe('Asia/Kolkata');
    expect(env.PORT).toBeDefined();
    expect(env.ROUTING_PROVIDER).toBe('osrm');
    expect(env.MESSAGING_PROVIDER).toBe('mock');
  });

  it('GET / returns operational service information', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('School Bus Tracking System');
    expect(res.body.status).toBe('operational');
    expect(res.body.health).toBe('/health');
    expect(res.body.api).toBe('/api/v1');
  });

  it('GET /health returns health diagnostics envelope', async () => {
    const res = await request(app).get('/health');
    // In local test without active PostgreSQL container, it returns 503 degraded gracefully
    expect([200, 503]).toContain(res.status);
    expect(res.body.service).toBe('School Bus Tracking System');
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(res.body.components).toBeDefined();
    expect(res.body.components.providers.routing).toBe('osrm');
    expect(res.body.system.memoryUsageMb).toBeGreaterThan(0);
  });

  it('GET /api/v1 returns available API endpoints list', async () => {
    const res = await request(app).get('/api/v1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.endpoints).toBeDefined();
    expect(res.body.endpoints.health).toBe('/health');
    expect(res.body.endpoints.auth).toBe('/api/v1/auth');
  });

  it('GET /non-existent-route returns structured 404 NotFound error JSON', async () => {
    const res = await request(app).get('/api/v1/non-existent-resource-endpoint');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('NotFoundError');
    expect(res.body.error.message).toContain('Route not found');
  });
});
