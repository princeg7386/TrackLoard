# Security & Backup Policy — School Bus Tracking System

## 1. Executive Summary & Security Objectives
The School Bus Tracking System handles high-stakes transport safety, child telemetry, parent contacts, and school operational workflows across India. This document establishes technical controls, secrets management, encryption standards, audit trails, abuse mitigations, and database backup/recovery protocols.

---

## 2. Secrets Management & Environment Isolation
1. **Zero Hardcoded Secrets Policy:**
   - No API keys, JWT secrets, database passwords, or SMS/WhatsApp credentials may ever exist in source code repositories.
   - All environments load secrets strictly via environment variables parsed and validated at boot via Zod (`backend/src/config/env.ts`).
2. **Production Secrets Validation:**
   - On production startup, `SecurityUtil.validateProductionSecrets()` verifies that `JWT_SECRET`, `PARENT_TOKEN_SECRET`, and `DATABASE_URL` are not placeholder strings and meet minimum 256-bit entropy requirements.
3. **Log Sanitization & Redaction:**
   - Structured JSON logging (`LoggerService`) automatically redacts sensitive keywords (`password`, `pin`, `token`, `secret`, `authorization`, `apiKey`, `cookie`).
   - Phone numbers in audit views are masked (`SecurityUtil.maskPhoneNumber`).

---

## 3. HTTPS, Network Security & HTTP Headers
1. **TLS / HTTPS Mandate:**
   - All public and API traffic MUST be served over TLS 1.3 (or minimum TLS 1.2).
   - In production behind Cloudflare / AWS ALB / Nginx reverse proxies, `trust proxy: 1` is enabled for accurate client IP identification.
2. **Strict Security Headers (Helmet):**
   - **HSTS (`Strict-Transport-Security`):** `max-age=31536000; includeSubDomains; preload`
   - **X-Frame-Options / Frameguard:** `DENY` (prevents clickjacking across parent & admin web views).
   - **X-Content-Type-Options:** `nosniff`.
   - **Content-Security-Policy (CSP):** Restricts script, style, and API connect origins.
   - **Referrer-Policy:** `strict-origin-when-cross-origin`.

---

## 4. Abuse Prevention & Rate Limiting Strategy
1. **Global API Baseline:** 120 requests/minute per IP.
2. **Admin & Driver Authentication (`/api/v1/auth/login`, `/api/v1/driver/auth/login`):**
   - Sliding-window limit of 10 login attempts per 15 minutes per IP.
   - Returns standard HTTP `429 Too Many Requests` envelope on breach.
3. **Parent WhatsApp Token Resolution (`/api/v1/parent/identity/lookup`, `/api/v1/parent/token/generate`):**
   - 20 requests per 5 minutes per client IP.
4. **GPS Ingestion Endpoint:**
   - High-throughput driver-specific rate limits (e.g. 60 telemetry points/minute per active trip).

---

## 5. Security Audit Logging Policy
1. **Immutable Audit Trail:**
   - All critical actions are recorded into the `audit_logs` table (`AuditService.logAction`).
   - Covered events: Admin login/logout, password resets, driver authentication, parent token generation, token revocation, SOS triggers, trip status changes, student stop assignments.
2. **Audit Schema:**
   - `school_id`, `user_id`, `user_role`, `action`, `entity_type`, `entity_id`, `diff_json` (sanitized), `ip_address`, `created_at`.
3. **Tenant Scoping:**
   - School Admins can only query audit records for their school (`WHERE school_id = $tenantId`).
   - Audit logs cannot be updated or deleted by School Admins or Coordinators.

---

## 6. Database Backup, Retention & Disaster Recovery Policy
1. **Recovery Objectives:**
   - **Recovery Point Objective (RPO):** $\le 15$ minutes (Continuous WAL archiving in production).
   - **Recovery Time Objective (RTO):** $\le 30$ minutes for full database restoration.
2. **Backup Schedule:**
   - **Daily Full Backups:** Automated `pg_dump` preserving PostGIS geometries, indexes, and triggers, executed at 02:00 IST daily.
   - **Hourly Incremental / WAL Snapshots:** Streamed to secure offsite object storage (AWS S3 / Cloudflare R2 / GCS with SSE-KMS encryption).
3. **Integrity Verification:**
   - Every backup artifact generates a companion `.meta.json` with a SHA-256 cryptographic checksum.
   - Automated monthly restore drill into an isolated staging container to verify zero corruption.
4. **Retention Policy:**
   - Daily backups: Retained for 30 days.
   - Weekly backups: Retained for 12 weeks.
   - Monthly backups: Retained for 12 months.
   - Audit logs: Retained for 3 years (statutory compliance).
