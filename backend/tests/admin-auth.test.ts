import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/services/auth.service.js';
import { UserRole } from '@school-bus/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Admin Authentication & Security Engine', () => {
  const app = createApp();

  const mockAdminUser = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    schoolId: '223e4567-e89b-12d3-a456-426614174001',
    email: 'transport.admin@dpsrkp.net',
    fullName: 'Sunil Sharma',
    role: UserRole.SCHOOL_ADMIN,
  };

  it('correctly hashes and verifies passwords using bcrypt', async () => {
    const rawPassword = 'SecureAdminPassword#2026';
    const hash = await AuthService.hashPassword(rawPassword);

    expect(hash).not.toBe(rawPassword);
    expect(hash.startsWith('$2')).toBe(true);

    const isMatch = await AuthService.verifyPassword(rawPassword, hash);
    expect(isMatch).toBe(true);

    const isWrongMatch = await AuthService.verifyPassword('WrongPassword', hash);
    expect(isWrongMatch).toBe(false);
  });

  it('generates and verifies signed JWT tokens with user payload', () => {
    const token = AuthService.generateToken(mockAdminUser);
    expect(token).toBeDefined();

    const decoded = AuthService.verifyToken(token);
    expect(decoded.id).toBe(mockAdminUser.id);
    expect(decoded.email).toBe(mockAdminUser.email);
    expect(decoded.role).toBe(UserRole.SCHOOL_ADMIN);
  });

  it('rejects invalid or corrupted JWT tokens with UnauthorizedError', () => {
    expect(() => AuthService.verifyToken('corrupted.invalid.jwt.token')).toThrow(
      'Invalid or expired authentication token'
    );
  });

  it('POST /api/v1/auth/login validates email and password fields', async () => {
    // 1. Missing body
    const res1 = await request(app).post('/api/v1/auth/login').send({});
    expect(res1.status).toBe(422);
    expect(res1.body.success).toBe(false);
    expect(res1.body.error.code).toBe('VALIDATION_ERROR');

    // 2. Invalid email format
    const res2 = await request(app).post('/api/v1/auth/login').send({
      email: 'not-an-email',
      password: 'somepassword',
    });
    expect(res2.status).toBe(422);
  });

  it('POST /api/v1/auth/logout returns 200 OK', async () => {
    const res = await request(app).post('/api/v1/auth/logout').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.loggedOut).toBe(true);
  });

  it('POST /api/v1/auth/forgot-password validates email format', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'invalid-email' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/v1/auth/reset-password validates token and minimum password length', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'abc', newPassword: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('GET /api/v1/auth/me requires valid Bearer token and authenticates properly', async () => {
    // 1. No token -> 401
    const resNoAuth = await request(app).get('/api/v1/auth/me');
    expect(resNoAuth.status).toBe(401);
    expect(resNoAuth.body.error.code).toBe('UnauthorizedError');

    // 2. Valid token with mocked getMe resolution
    const token = AuthService.generateToken(mockAdminUser);
    const getMeSpy = vi
      .spyOn(AuthService, 'getMe')
      .mockResolvedValueOnce(mockAdminUser);

    const resAuth = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(resAuth.status).toBe(200);
    expect(resAuth.body.success).toBe(true);
    expect(resAuth.body.data.email).toBe('transport.admin@dpsrkp.net');
    expect(resAuth.body.data.role).toBe(UserRole.SCHOOL_ADMIN);

    getMeSpy.mockRestore();
  });

  it('PUT /api/v1/auth/profile updates admin mobile phone and full name', async () => {
    const token = AuthService.generateToken(mockAdminUser);
    const updatedUser = {
      ...mockAdminUser,
      fullName: 'Vikram Singh Verma',
      phone: '+919811998877',
    };

    const updateSpy = vi
      .spyOn(AuthService, 'updateAdminProfile')
      .mockResolvedValueOnce(updatedUser);

    const res = await request(app)
      .put('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Vikram Singh Verma',
        phone: '9811998877',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.fullName).toBe('Vikram Singh Verma');
    expect(res.body.data.phone).toBe('+919811998877');

    updateSpy.mockRestore();
  });

  it('verifies migration 005_auth_password_reset.sql exists with correct schema alterations', () => {
    const migrationPath = path.join(
      __dirname,
      '../src/db/migrations/005_auth_password_reset.sql'
    );
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('password_reset_token');
    expect(sql).toContain('password_reset_expires_at');
  });
});
