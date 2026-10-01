-- Make the database enforce the ledger's invariants, not just the app:
--   * entry_date is a real DATE (rejects 2026-02-31)
--   * no zero-amount lines; is_active is a 0/1 flag
--   * every entry's lines sum to zero and there are at least two (checked at commit)
--   * the audit trail is append-only: lines never change, entries are never deleted,
--     and the only allowed update is status POSTED -> VOID
-- Idempotent: every statement is guarded or CREATE OR REPLACE.

DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'journal_entries' AND column_name = 'entry_date') <> 'date' THEN
    ALTER TABLE journal_entries ALTER COLUMN entry_date TYPE DATE USING entry_date::date;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_lines_amount_nonzero') THEN
    ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_amount_nonzero CHECK (amount_minor <> 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_is_active_flag') THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_is_active_flag CHECK (is_active IN (0, 1));
  END IF;
END $$;

-- Balance check. Deferred to commit so an entry's lines can be inserted one by one
-- inside a transaction; the check runs once they are all in place.
CREATE OR REPLACE FUNCTION ledger_check_entry_balanced() RETURNS trigger AS $$
DECLARE
  total BIGINT;
  line_count INTEGER;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0), COUNT(*) INTO total, line_count
  FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF total <> 0 OR line_count < 2 THEN
    RAISE EXCEPTION 'journal entry % is unbalanced (sum %, % lines)', NEW.entry_id, total, line_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_lines_balanced ON journal_lines;
CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_entry_balanced();

-- Append-only audit trail.
CREATE OR REPLACE FUNCTION ledger_forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: the ledger is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ledger_guard_entry_update() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' AND NEW.status = 'VOID'
     AND (NEW.id, NEW.entry_date, NEW.memo, NEW.reference, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.entry_date, OLD.memo, OLD.reference, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'journal entry % cannot change from % to %: only POSTED -> VOID is allowed',
    OLD.id, OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_lines_append_only ON journal_lines;
CREATE TRIGGER journal_lines_append_only
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION ledger_forbid_change();

DROP TRIGGER IF EXISTS journal_entries_no_delete ON journal_entries;
CREATE TRIGGER journal_entries_no_delete
  BEFORE DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_forbid_change();

DROP TRIGGER IF EXISTS journal_entries_guard_update ON journal_entries;
CREATE TRIGGER journal_entries_guard_update
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_guard_entry_update();
