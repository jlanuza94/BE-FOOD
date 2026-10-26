#!/usr/bin/env bash
# Prueba las migraciones en un Postgres local (no toca Supabase).
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=befood_pruebas
dropdb --if-exists "$DB"
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/stub_supabase.sql
# Las migraciones *_supabase_* usan storage y pg_cron, que solo existen en Supabase.
for f in $(ls supabase/migrations/*.sql | grep -v _supabase_); do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
for t in supabase/tests/etapa1.sql supabase/tests/etapa2.sql supabase/tests/mejoras.sql supabase/tests/etapa3.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$t"
done
