-- An entry must commit with at least two balanced lines. 0002's balance check
-- fires per inserted line, so an entry inserted with no lines at all skipped it
-- and committed (found by the ledger-architect sub-agent). This checks from the
-- entry side too, at commit, so the lines can still follow in the same transaction.
--
-- Idempotent: function replaced, trigger re-created on every run. It fires on
-- new entries only; existing rows are not re-checked.

CREATE OR REPLACE FUNCTION ledger_check_entry_has_lines() RETURNS trigger AS $$
DECLARE
  total BIGINT;
  line_count INTEGER;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0), COUNT(*) INTO total, line_count
  FROM journal_lines WHERE entry_id = NEW.id;
  IF total <> 0 OR line_count < 2 THEN
    RAISE EXCEPTION 'journal entry % is unbalanced (sum %, % lines)', NEW.id, total, line_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_entries_have_lines ON journal_entries;
CREATE CONSTRAINT TRIGGER journal_entries_have_lines
  AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_entry_has_lines();
