-- Enforce EUR as the single base currency for manually maintained exchange
-- rates (see src/app/(app)/exchange-rates/actions.ts and
-- src/lib/exchangeRate.ts). Every row must represent "1 EUR = rate target";
-- historically a rate could be stored in either direction, e.g. both
-- "1 USD = X EUR" and "1 EUR = X USD" for the same pair. No structural
-- schema change is needed (Currency/ExchangeRate are unchanged) - this is a
-- data-only cleanup, applied automatically via `prisma migrate deploy`
-- (see package.json "build") like every other migration in this project.

-- Step 1: where a pair has rows stored in BOTH directions, the non-EUR-based
-- row is a competing duplicate - drop it and keep the existing EUR-based row
-- as the single source of truth.
DELETE FROM "ExchangeRate" reversed
WHERE reversed."baseCurrency" <> 'EUR'
  AND reversed."quoteCurrency" = 'EUR'
  AND EXISTS (
    SELECT 1 FROM "ExchangeRate" canonical
    WHERE canonical."baseCurrency" = 'EUR'
      AND canonical."quoteCurrency" = reversed."baseCurrency"
  );

-- Step 2: any remaining non-EUR-based row (no EUR-based counterpart existed)
-- is converted in place into the equivalent EUR-based row by swapping the
-- currencies and inverting the rate, so no manually maintained rate is lost.
-- Postgres evaluates all SET expressions against the pre-update row values,
-- so this swap is safe even though baseCurrency/quoteCurrency reference each
-- other. Rows with rate = 0 are left untouched (already invalid data that
-- the application never allows to be created) rather than divided by zero.
UPDATE "ExchangeRate"
SET "baseCurrency" = "quoteCurrency",
    "quoteCurrency" = "baseCurrency",
    rate = round(1 / rate, 6)
WHERE "baseCurrency" <> 'EUR'
  AND "quoteCurrency" = 'EUR'
  AND rate <> 0;
