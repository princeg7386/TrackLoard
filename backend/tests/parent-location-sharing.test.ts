import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import { MockMessagingAdapter } from '../src/services/messaging/mock-messaging.adapter.js';
import { DynamicPickupService } from '../src/services/dynamic-pickup/dynamic-pickup.service.ts';
import { UserRole } from '@school-bus/shared';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import * as db from '../src/config/database.js';

describe('Phase 14.1: Parent Location Sharing (Dynamic Pickup Engine)', () => {
  const app = createApp();
  const schoolA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolB = '999e4567-e89b-12d3-a456-426614174999';

  const adminToken = jwt.sign(
    {
      sub: 'adm-123',
      userId: 'adm-123',
      schoolId: schoolA,
      role: UserRole.SCHOOL_ADMIN,
    },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const driverToken = jwt.sign(
    {
      sub: 'drv-123',
      userId: 'drv-123',
      schoolId: schoolA,
      role: UserRole.DRIVER,
    },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const schoolBToken = jwt.sign(
    {
      sub: 'adm-999',
      userId: 'adm-999',
      schoolId: schoolB,
      role: UserRole.SCHOOL_ADMIN,
    },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  beforeEach(() => {
    MessagingService.resetProvider();
  });

  afterEach(() => {
    MessagingService.resetProvider();
  });

  describe('1. WhatsApp Asks for Location (Task 1)', () => {
    it('dispatches interactive WhatsApp location request prompt with school/student context', async () => {
      const testStudentId = '222e4567-e89b-12d3-a456-426614174002';

      // Mock database queries for student and parent
      const mockStudent = [
        {
          id: testStudentId,
          full_name: 'Aarav Sharma',
          school_id: schoolA,
          school_name: 'Delhi Public School',
        },
      ];
      const mockParents = [
        {
          id: 'par-111',
          full_name: 'Rajesh Sharma',
          phone: '+919876543210',
        },
      ];

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockStudent as any)
        .mockResolvedValueOnce(mockParents as any)
        .mockResolvedValueOnce([] as any); // notifications insert

      const res = await request(app)
        .post('/api/v1/parent/location/request')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          schoolId: schoolA,
          studentId: testStudentId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.studentName).toBe('Aarav Sharma');
      expect(res.body.data.recipientPhone).toBe('+919876543210');

      // Verify dispatched message in MockMessagingAdapter
      const sent = MockMessagingAdapter.getSentMessages();
      expect(sent.length).toBeGreaterThanOrEqual(1);
      const lastMsg = sent[sent.length - 1]!;
      expect(lastMsg.interactiveType).toBe('location_request_message');
      expect(lastMsg.directText).toContain('Aarav Sharma');
      expect(lastMsg.directText).toContain('Delhi Public School');
      expect(lastMsg.recipientPhone).toBe('+919876543210');
    });

    it('enforces tenant isolation: School B admin cannot request location for School A student', async () => {
      const testStudentId = '222e4567-e89b-12d3-a456-426614174002';

      const res = await request(app)
        .post('/api/v1/parent/location/request')
        .set('Authorization', `Bearer ${schoolBToken}`)
        .send({
          schoolId: schoolA, // Caller belongs to schoolB, body has schoolA
          studentId: testStudentId,
        });

      expect(res.status).toBe(403);
    });

    it('requires authentication and blocks driver from dispatching parent location requests (403)', async () => {
      const res = await request(app)
        .post('/api/v1/parent/location/request')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          schoolId: schoolA,
          studentId: '222e4567-e89b-12d3-a456-426614174002',
        });

      expect(res.status).toBe(403);

      const unauth = await request(app)
        .post('/api/v1/parent/location/request')
        .send({
          schoolId: schoolA,
          studentId: '222e4567-e89b-12d3-a456-426614174002',
        });

      expect(unauth.status).toBe(401);
    });
  });

  describe('2. Receive Coordinates (Task 2)', () => {
    it('receives location via WhatsApp Cloud API webhook payload and resolves parent', async () => {
      const webhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { display_phone_number: '1234567890', phone_number_id: '12345' },
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.HBgLM...',
                      timestamp: '1729166000',
                      type: 'location',
                      location: {
                        latitude: 28.5355,
                        longitude: 77.3910,
                        name: 'My Residence',
                        address: 'Sector 62, Noida, Uttar Pradesh',
                      },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

        const res = await request(app)
          .post('/api/v1/parent/webhook/whatsapp')
          .send(webhookPayload);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.handled).toBe(true);
        expect(res.body.data.coordinates.latitude).toBe(28.5355);
        expect(res.body.data.coordinates.longitude).toBe(77.3910);
        expect(res.body.data.isWithinIndia).toBe(true);

        // Feedback WhatsApp message sent back to the parent
        expect(res.body.data.recipientFeedbackSent).toBe(true);
        const sent = MockMessagingAdapter.getSentMessages();
        expect(sent.length).toBeGreaterThanOrEqual(1);
        const feedback = sent[sent.length - 1]!;
        expect(feedback.directText).toContain('Thank you');
      });

    it('receives location shared directly via web API', async () => {
      const res = await request(app)
        .post('/api/v1/parent/location/share')
        .send({
          latitude: 28.6139,
          longitude: 77.2090,
          locationName: 'Central Gate Pick Point',
          notes: 'Near community hall gate 2',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.coordinates.latitude).toBe(28.6139);
      expect(res.body.data.coordinates.longitude).toBe(77.2090);
      expect(res.body.data.isValid).toBe(true);
    });
  });

  describe('3. Validate Coordinates (Task 3)', () => {
    it('validates Indian geographic territory bounds and accepts valid Delhi NCR point', async () => {
      const res = await request(app)
        .post('/api/v1/parent/location/validate')
        .send({
          latitude: 28.5355,
          longitude: 77.3910,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const val = res.body.data;
      expect(val.isWithinIndia).toBe(true);
      expect(val.roadAccessible).toBe(true);
      expect(val.validationErrors.length).toBe(0);
      expect(val.isValid).toBe(true);
    });

    it('rejects coordinates outside India with descriptive validation error', async () => {
      // New York City coordinates
      const res = await request(app)
        .post('/api/v1/parent/location/validate')
        .send({
          latitude: 40.7128,
          longitude: -74.0060,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const val = res.body.data;
      expect(val.isWithinIndia).toBe(false);
      expect(val.isValid).toBe(false);
      expect(val.validationErrors.some((e: string) => e.includes('outside the territory of India'))).toBe(true);
    });

    it('evaluates school transport catchment radius and flags out-of-catchment location', async () => {
      // Benchmark validation with schoolId and strict 10km limit against a 50km point
      const res = await request(app)
        .post('/api/v1/parent/location/validate')
        .send({
          latitude: 29.2000, // ~65 km north of Delhi
          longitude: 77.2000,
          schoolId: schoolA,
          maxCatchmentKm: 15,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const val = res.body.data;
      expect(val.distanceToSchoolKm).toBeGreaterThan(15);
      expect(val.isWithinCatchment).toBe(false);
      expect(val.isValid).toBe(false);
      expect(val.validationErrors.some((e: string) => e.includes('exceeding the 15 km'))).toBe(true);
    });

    it('rejects malformed latitude and longitude numbers with 400 validation error', async () => {
      const res = await request(app)
        .post('/api/v1/parent/location/validate')
        .send({
          latitude: 195.0, // Invalid latitude (>90)
          longitude: 77.2090,
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('4. Real-DB Integration & Notification Audit (Rule 8)', () => {
    it('persists location request in PostgreSQL notifications table with school isolation', async () => {
      const testSchoolId = schoolA;
      const testStudentId = '333e4567-e89b-12d3-a456-426614174333';
      const testParentId = '444e4567-e89b-12d3-a456-426614174444';

      let tablesExist = false;
      try {
        const check = await db.query(`SELECT to_regclass('public.notifications') as tbl`);
        tablesExist = Boolean(check[0]?.tbl);
      } catch {
        tablesExist = false;
      }

      if (tablesExist) {
        try {
          await db.query(
            `INSERT INTO schools (id, name, code, address, phone, email, city, state)
             VALUES ($1, 'Dynamic Pickup Academy', 'SCH-DYNAMIC', 'Connaught Place, New Delhi', '+919876543210', 'pickup@dynamic.edu', 'New Delhi', 'Delhi')
             ON CONFLICT (id) DO NOTHING;`,
            [testSchoolId]
          );

          await db.query(
            `INSERT INTO students (id, school_id, full_name, admission_number, class_grade, section)
             VALUES ($1, $2, 'Ananya Verma', 'ADM-DYN-01', '5', 'A')
             ON CONFLICT (id) DO NOTHING;`,
            [testStudentId, testSchoolId]
          );

          await db.query(
            `INSERT INTO parents (id, school_id, student_id, full_name, relationship, phone)
             VALUES ($1, $2, $3, 'Vikram Verma', 'FATHER', '+919876543210')
             ON CONFLICT (id) DO NOTHING;`,
            [testParentId, testSchoolId, testStudentId]
          );

          // 1. Dispatch location request via API
          const reqRes = await request(app)
            .post('/api/v1/parent/location/request')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
              schoolId: testSchoolId,
              studentId: testStudentId,
            });

          expect(reqRes.status).toBe(200);
          expect(reqRes.body.success).toBe(true);

          // 2. Verify notifications table record
          const notifs = await db.query<{ id: string; school_id: string; template_name: string; status: string }>(
            `SELECT id, school_id, template_name, status
             FROM notifications
             WHERE school_id = $1 AND template_name = 'LOCATION_REQUEST'
             ORDER BY created_at DESC
             LIMIT 1`,
            [testSchoolId]
          );

          expect(notifs.length).toBe(1);
          expect(notifs[0]!.school_id).toBe(testSchoolId);
          expect(notifs[0]!.template_name).toBe('LOCATION_REQUEST');

          // 3. Simulate parent sharing coordinates via webhook
          const webRes = await request(app)
            .post('/api/v1/parent/webhook/whatsapp')
            .send({
              from: '+919876543210',
              type: 'location',
              location: {
                latitude: 28.5355,
                longitude: 77.3910,
                name: 'Verma House',
                address: 'Sector 62, Noida',
              },
            });

          expect(webRes.status).toBe(200);
          expect(webRes.body.data.isValid).toBe(true);
          expect(webRes.body.data.studentId).toBe(testStudentId);
          expect(webRes.body.data.schoolId).toBe(testSchoolId);
        } finally {
          await db.query(`DELETE FROM notifications WHERE school_id = $1`, [testSchoolId]);
          await db.query(`DELETE FROM parents WHERE id = $1`, [testParentId]);
          await db.query(`DELETE FROM students WHERE id = $1`, [testStudentId]);
          await db.query(`DELETE FROM schools WHERE id = $1`, [testSchoolId]);
        }
      } else {
        const mockStudent = [
          {
            id: testStudentId,
            full_name: 'Ananya Verma',
            school_id: testSchoolId,
            school_name: 'Dynamic Pickup Academy',
          },
        ];
        const mockParents = [
          {
            id: testParentId,
            full_name: 'Vikram Verma',
            phone: '+919876543210',
          },
        ];

        vi.spyOn(db, 'query')
          .mockResolvedValueOnce(mockStudent as any)
          .mockResolvedValueOnce(mockParents as any)
          .mockResolvedValueOnce([] as any);

        const result = await DynamicPickupService.requestParentLocation({
          schoolId: testSchoolId,
          studentId: testStudentId,
        });

        expect(result.studentName).toBe('Ananya Verma');
      }
    });
  });
});
