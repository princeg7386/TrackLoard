#!/usr/bin/env bash
# Phase 2 / 3 audit: apply every migration to a fresh PostGIS DB, then PREPARE every SQL string
# found in backend/src against that schema. PREPARE checks tables/columns without running anything.
# Usage (from repo root, with `docker compose -f infrastructure/docker-compose.yml up -d` running):
#   bash audit-tests/check-sql.sh
set -uo pipefail
PSQL="psql postgresql://postgres:postgrespassword@localhost:5432/postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "DROP DATABASE IF EXISTS audit_fresh" -c "CREATE DATABASE audit_fresh"
DB="psql postgresql://postgres:postgrespassword@localhost:5432/audit_fresh -q"
$DB -c 'CREATE EXTENSION IF NOT EXISTS postgis' >/dev/null
echo "== Migrations on a fresh database"
for f in backend/src/db/migrations/*.sql; do
  if $DB -v ON_ERROR_STOP=1 -1 -f "$f" >/tmp/mig.out 2>&1; then echo "  OK   $(basename "$f")"; else echo "  FAIL $(basename "$f")"; grep ERROR /tmp/mig.out | sed 's/^/       /'; break; fi
done
echo "== SQL used by services vs. schema"
node audit-tests/extract-sql.cjs backend/src /tmp/queries.json
node -e '
const q=require("/tmp/queries.json");let s="";
q.forEach((x,i)=>{let sql=x.sql.replace(/\$\{whereSql\}/g,"school_id = $1").replace(/\$\{[^}]+\}/g,"").trim().replace(/;\s*$/,"");s+=`\\echo @@${i}\nPREPARE p${i} AS ${sql};\n`;});
require("fs").writeFileSync("/tmp/prep.sql",s);'
$DB -f /tmp/prep.sql >/tmp/prep.out 2>&1
node -e '
const q=require("/tmp/queries.json");const L=require("fs").readFileSync("/tmp/prep.out","utf8").split("\n");let c=null,n=0;
for(const l of L){const m=l.match(/^@@(\d+)/);if(m){c=+m[1];continue;}if(/ERROR/.test(l)&&!/schema_migrations|syntax error at or near "\$"|inconsistent types/.test(l)){n++;console.log("  FAIL "+q[c].file+":"+q[c].line+"  "+l.replace(/^.*ERROR:\s*/,""));}}
console.log(n?`  ${n} queries reference missing tables/columns`:"  all queries match the schema");'
