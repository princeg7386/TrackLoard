import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../src/app.js';
import { SchoolProfileService } from '../src/services/school-profile.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { UserRole, School } from '@school-bus/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('School Profile & Settings Management (Micro-phase 5.1)', () => {
  const app = createApp();

  const schoolIdA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolIdB = '999e4567-e89b-12d3-a456-426614174999';

  const adminUserA = {
    id: 'aaa11111-e89b-12d3-a456-426614174001',
    schoolId: schoolIdA,
    email: 'admin.a@dpa.edu.in',
    fullName: 'Principal Sharma',
    role: UserRole.SCHOOL_ADMIN,
  };

  const coordinatorUserA = {
    id: 'aaa22222-e89b-12d3-a456-426614174002',
    schoolId: schoolIdA,
    email: 'coordinator.a@dpa.edu.in',
    fullName: 'Transport Coordinator',
    role: UserRole.TRANSPORT_COORDINATOR,
  };

  const mockSchoolProfile: School = {
    id: schoolIdA,
    name: 'Delhi Public Academy',
    code: 'DPA-ND',
    address: 'Plot 12, Institutional Area, Vasant Kunj',
    city: 'New Delhi',
    state: 'Delhi',
    postalCode: '110070',
    phone: '+919811223344',
    email: 'contact@dpa.edu.in',
    logoUrl: 'https://images.example.in/logos/dpa-logo.png',
    affiliationNumber: 'CBSE-AFF-2026-9901',
    website: 'https://dpa.edu.in',
    timezone: 'Asia/Kolkata',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  describe('1. GET /api/v1/schools/:schoolId/profile', () => {
    it('returns 200 OK with school profile for authenticated School Admin in same tenant', async () => {
      const token = AuthService.generateToken(adminUserA);

      const getSpy = vi
        .spyOn(SchoolProfileService, 'getSchoolProfile')
        .mockResolvedValueOnce(mockSchoolProfile);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/profile`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Delhi Public Academy');
      expect(res.body.data.city).toBe('New Delhi');
      expect(res.body.data.affiliationNumber).toBe('CBSE-AFF-2026-9901');

      getSpy.mockRestore();
    });

    it('rejects cross-tenant access to another school with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdB}/profile`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
      expect(res.body.error.message).toContain('another school');
    });

    it('returns 401 Unauthorized when Bearer token is missing', async () => {
      const res = await request(app).get(`/api/v1/schools/${schoolIdA}/profile`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. PUT /api/v1/schools/:schoolId/profile', () => {
    const validUpdatePayload = {
      name: 'Delhi Public Academy - Main Campus',
      address: 'Plot 12 & 14, Institutional Area, Vasant Kunj',
      city: 'New Delhi',
      state: 'Delhi',
      postalCode: '110070',
      phone: '9811223344',
      email: 'principal@dpa.edu.in',
      logoUrl: 'https://images.example.in/logos/dpa-logo-v2.png',
      affiliationNumber: 'CBSE-AFF-2026-9901',
      website: 'https://dpa.edu.in',
      timezone: 'Asia/Kolkata',
    };

    it('updates school profile successfully and returns updated metadata', async () => {
      const token = AuthService.generateToken(adminUserA);

      const updatedProfile: School = {
        ...mockSchoolProfile,
        name: 'Delhi Public Academy - Main Campus',
        email: 'principal@dpa.edu.in',
        logoUrl: 'https://images.example.in/logos/dpa-logo-v2.png',
      };

      const updateSpy = vi
        .spyOn(SchoolProfileService, 'updateSchoolProfile')
        .mockResolvedValueOnce(updatedProfile);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/profile`)
        .set('Authorization', `Bearer ${token}`)
        .send(validUpdatePayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Delhi Public Academy - Main Campus');
      expect(res.body.data.email).toBe('principal@dpa.edu.in');

      updateSpy.mockRestore();
    });

    it('validates required fields and rejects invalid email or phone with 422', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/profile`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: '',
          email: 'not-a-valid-email',
          phone: '123',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects profile update from Transport Coordinator with 403 (School Admin required)', async () => {
      const token = AuthService.generateToken(coordinatorUserA);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/profile`)
        .set('Authorization', `Bearer ${token}`)
        .send(validUpdatePayload);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });
  });

  describe('3. Database Migration 008 Verification', () => {
    it('verifies 008_school_profile_enhancements.sql exists with logo_url and affiliation_number columns', () => {
      const migrationFile = path.join(
        __dirname,
        '../src/db/migrations/008_school_profile_enhancements.sql'
      );
      expect(fs.existsSync(migrationFile)).toBe(true);
      const sql = fs.readFileSync(migrationFile, 'utf-8');
      expect(sql).toContain('logo_url');
      expect(sql).toContain('affiliation_number');
      expect(sql).toContain('website');
    });
  });
});
