-- Daily per-account balance rollups, so a report's cost no longer grows with
-- the number of journal lines (INFRASTRUCTURE-PLAN.md ADR-003). A report sums
-- one row per (day, account) with activity in its range instead of every line.
--
--   account_balances_daily  gross debits/credits of POSTED lines per account and day
--   ledger_days             POSTED entry count per day (the dashboard's entryCount)
--
-- Both are maintained by triggers in the same transaction as the post or void,
-- so they are never stale. The trigger functions run as the owner (SECURITY
-- DEFINER): the app role can read the rollups but not write them.
-- `ledger_rollup_drift` lists any (day, account) where the rollup disagrees with
-- the raw lines; it must always be empty (nightly check).
--
-- ponytail: daily grain only; a full-history report reads days x accounts rows
-- (~730 for a year of the rehearsal data). Add a monthly level on top when
-- history x accounts makes that slow.
--
-- Idempotent: the tables are created and backfilled once; functions, triggers,
-- view and grants are (re)applied on every run.

DO $$ BEGIN
  IF to_regclass('public.account_balances_daily') IS NULL THEN
    CREATE TABLE account_balances_daily (
      day           DATE NOT NULL,
      account_id    VARCHAR(64) NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
      debit_minor   BIGINT NOT NULL DEFAULT 0,
      credit_minor  BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (day, account_id)
    );
    CREATE TABLE ledger_days (
      day             DATE PRIMARY KEY,
      posted_entries  INTEGER NOT NULL DEFAULT 0
    );
    -- Block writes until this file commits (with the triggers below in place),
    -- so no posting lands between the backfill and the triggers. Measured: 16 s
    -- for the whole migration job on 744k lines.
    LOCK TABLE journal_entries, journal_lines IN SHARE MODE;
    INSERT INTO account_balances_daily (day, account_id, debit_minor, credit_minor)
    SELECT e.entry_date, l.account_id, sum(greatest(l.amount_minor, 0)), sum(greatest(-l.amount_minor, 0))
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
    WHERE e.status = 'POSTED'
    GROUP BY 1, 2;
    INSERT INTO ledger_days (day, posted_entries)
    SELECT entry_date, count(*) FROM journal_entries WHERE status = 'POSTED' GROUP BY 1;
  END IF;
END $$;

-- ponytail: one global transaction lock, taken by every rollup trigger before
-- its first rollup write, so writers can never deadlock on rollup rows (a post
-- and a void did, in the contract test); fine at < 10 writes/s, lock per
-- account in sorted order if posting throughput ever matters.

-- A line of a POSTED entry: add just that line.
CREATE OR REPLACE FUNCTION ledger_rollup_line() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  entry RECORD;
BEGIN
  SELECT status, entry_date INTO entry FROM journal_entries WHERE id = NEW.entry_id;
  IF entry.status = 'POSTED' THEN
    PERFORM pg_advisory_xact_lock(hashtext('ledger_rollup'));
    INSERT INTO account_balances_daily AS b (day, account_id, debit_minor, credit_minor)
    VALUES (entry.entry_date, NEW.account_id, greatest(NEW.amount_minor, 0), greatest(-NEW.amount_minor, 0))
    ON CONFLICT (day, account_id) DO UPDATE
      SET debit_minor = b.debit_minor + EXCLUDED.debit_minor,
          credit_minor = b.credit_minor + EXCLUDED.credit_minor;
  END IF;
  RETURN NULL;
END $$;

-- Entry inserted as POSTED, or moved into/out of POSTED (today only POSTED -> VOID).
CREATE OR REPLACE FUNCTION ledger_rollup_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  delta INTEGER := (NEW.status = 'POSTED')::int
                 - (TG_OP = 'UPDATE' AND OLD.status = 'POSTED')::int;
BEGIN
  IF delta = 0 THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ledger_rollup'));
  -- On INSERT the entry has no lines yet; ledger_rollup_line adds them.
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO account_balances_daily AS b (day, account_id, debit_minor, credit_minor)
    SELECT NEW.entry_date, account_id,
           delta * sum(greatest(amount_minor, 0)), delta * sum(greatest(-amount_minor, 0))
    FROM journal_lines WHERE entry_id = NEW.id
    GROUP BY account_id
    ON CONFLICT (day, account_id) DO UPDATE
      SET debit_minor = b.debit_minor + EXCLUDED.debit_minor,
          credit_minor = b.credit_minor + EXCLUDED.credit_minor;
  END IF;
  INSERT INTO ledger_days AS d (day, posted_entries)
  VALUES (NEW.entry_date, delta)
  ON CONFLICT (day) DO UPDATE SET posted_entries = d.posted_entries + EXCLUDED.posted_entries;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS journal_lines_rollup ON journal_lines;
CREATE TRIGGER journal_lines_rollup
  AFTER INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION ledger_rollup_line();

DROP TRIGGER IF EXISTS journal_entries_rollup ON journal_entries;
CREATE TRIGGER journal_entries_rollup
  AFTER INSERT OR UPDATE OF status ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_rollup_entry();

CREATE OR REPLACE VIEW ledger_rollup_drift AS
WITH raw AS (
  SELECT e.entry_date AS day, l.account_id,
         sum(greatest(l.amount_minor, 0)) AS debit_minor,
         sum(greatest(-l.amount_minor, 0)) AS credit_minor
  FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
  WHERE e.status = 'POSTED'
  GROUP BY 1, 2
)
SELECT coalesce(r.day, b.day) AS day,
       coalesce(r.account_id, b.account_id) AS account_id,
       coalesce(r.debit_minor, 0) AS raw_debit_minor, coalesce(b.debit_minor, 0) AS rollup_debit_minor,
       coalesce(r.credit_minor, 0) AS raw_credit_minor, coalesce(b.credit_minor, 0) AS rollup_credit_minor
FROM raw r
FULL JOIN account_balances_daily b ON b.day = r.day AND b.account_id = r.account_id
WHERE coalesce(r.debit_minor, 0) <> coalesce(b.debit_minor, 0)
   OR coalesce(r.credit_minor, 0) <> coalesce(b.credit_minor, 0);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerlab_app') THEN
    REVOKE ALL ON account_balances_daily, ledger_days, ledger_rollup_drift FROM ledgerlab_app;
    GRANT SELECT ON account_balances_daily, ledger_days, ledger_rollup_drift TO ledgerlab_app;
  END IF;
END $$;
