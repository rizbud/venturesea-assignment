-- Least-privilege runtime role. The app connects as `ledgerlab_app`; migrations
-- run as the schema owner. The role and its password are created once, out of
-- band, from the secret store (never in git):
--
--   CREATE ROLE ledgerlab_app LOGIN PASSWORD '<from the secret store>';
--
-- This migration (re)applies the grants whenever the role exists, so it is safe
-- on databases that have not created it yet.
--
-- The app needs SELECT/INSERT on everything and UPDATE only where it changes
-- state (account active flag, entry status). It never needs DELETE, TRUNCATE
-- (which would skip the append-only row triggers), REFERENCES, TRIGGER or DDL.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerlab_app') THEN
    REVOKE ALL ON accounts, journal_entries, journal_lines FROM ledgerlab_app;
    GRANT USAGE ON SCHEMA public TO ledgerlab_app;
    GRANT SELECT, INSERT ON accounts, journal_entries, journal_lines TO ledgerlab_app;
    GRANT UPDATE (is_active) ON accounts TO ledgerlab_app;
    GRANT UPDATE (status) ON journal_entries TO ledgerlab_app;
    -- No CREATE on the schema (Postgres 15+ already revokes it from PUBLIC).
    REVOKE CREATE ON SCHEMA public FROM ledgerlab_app;
  END IF;
END $$;
