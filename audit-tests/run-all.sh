#!/usr/bin/env bash
# Runs the whole audit. From repo root:  bash audit-tests/run-all.sh
set -uo pipefail
npm install
npm run build --workspace=shared            # backend imports @school-bus/shared from dist/
echo "== Existing vitest suite"; (cd backend && npx vitest run) || true
echo "== Audit: logic tests";      npx tsx --test audit-tests/logic.test.ts || true
echo "== Audit: route auth matrix"; npx tsx --test audit-tests/route-auth.test.ts || true
echo "== Audit: SQL vs schema";     bash audit-tests/check-sql.sh || true
echo "== Audit: DB behaviour";      psql postgresql://postgres:postgrespassword@localhost:5432/audit_fresh -q -t -f audit-tests/db-behaviour.sql || true
