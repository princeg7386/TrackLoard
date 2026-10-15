# BUSLOARD audit tests (Phase 0–11)

Ye folder repo root mein `audit-tests/` naam se rakh. Phir:

```bash
docker compose -f infrastructure/docker-compose.yml up -d   # PostGIS + Redis
bash audit-tests/run-all.sh
```

| File | Kya check karta hai |
|---|---|
| `logic.test.ts` | Phone/plate validation, telemetry schema vs service, GPS health, secrets check on boot |
| `route-auth.test.ts` | Har API route pe auth + role guard (69 routes) |
| `check-sql.sh` | Fresh DB pe saari migrations + services ka har SQL query schema se match |
| `db-behaviour.sql` | Soft-delete ke baad re-add, GPS dedupe, triggers, constraints |

Jab saare bugs fix ho jayein, ye saare tests green hone chahiye.
