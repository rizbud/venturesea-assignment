-- Widen journal_lines.amount_minor to BIGINT. INTEGER caps a single line at
-- 2,147,483,647 minor units: about Rp 2.1bn (IDR has no minor unit) or $21.4M.
-- Guarded so re-running is a no-op instead of a second table rewrite.
-- Note: the type change rewrites the table under an exclusive lock; run it in a
-- maintenance window once journal_lines is large.

DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'journal_lines' AND column_name = 'amount_minor') = 'integer' THEN
    ALTER TABLE journal_lines ALTER COLUMN amount_minor TYPE BIGINT;
  END IF;
END $$;
