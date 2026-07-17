-- RIF mutant detector schema.
-- Applied by `npm run db:setup`. Idempotent: safe to run more than once.

-- Append-only record of every verified DNA (one row per submission).
CREATE TABLE IF NOT EXISTS dna_records (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dna         TEXT NOT NULL,          -- normalised rows joined by newline
    is_mutant   BOOLEAN NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Materialised counters (exactly one row) for O(1) stats.
CREATE TABLE IF NOT EXISTS dna_stats (
    id            BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    count_mutant  BIGINT NOT NULL DEFAULT 0,
    count_human   BIGINT NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the single stats row.
INSERT INTO dna_stats (id, count_mutant, count_human)
VALUES (true, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- Canonical ratio definition (mutant / human), div-by-zero -> 0.
CREATE OR REPLACE FUNCTION dna_ratio(mutant BIGINT, human BIGINT)
RETURNS NUMERIC AS $$
  SELECT CASE
           WHEN human = 0 THEN 0
           ELSE ROUND(mutant::numeric / human, 4)
         END;
$$ LANGUAGE sql IMMUTABLE;
