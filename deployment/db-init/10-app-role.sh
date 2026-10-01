#!/bin/sh
# Runs once when the local Postgres volume is first initialised (docker-entrypoint-initdb.d).
# Creates the least-privilege runtime role; 0003_app_role.sql then grants it access.
# The password comes from the environment and is passed as a psql variable, never interpolated into SQL.
set -eu
psql -v ON_ERROR_STOP=1 -v pw="$APP_DB_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE ledgerlab_app LOGIN PASSWORD :'pw';
SQL
