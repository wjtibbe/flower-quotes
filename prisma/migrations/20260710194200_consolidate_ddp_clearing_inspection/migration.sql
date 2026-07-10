-- Data migration: consolidate any existing separate CLEARING_PER_STEM and
-- INSPECTION_PER_STEM rates into a single CLEARING_AND_INSPECTION_PER_STEM
-- rate per route (summed), since the app now bills these as one combined
-- price. Old rows are deactivated (not deleted) so history is preserved.
-- Must run as its own migration, after the enum value was added and
-- committed in the previous migration (Postgres does not allow using a
-- brand-new enum value in the same transaction that added it).

-- Routes that had a CLEARING_PER_STEM rate (with or without a matching
-- INSPECTION_PER_STEM rate).
INSERT INTO "DdpCostRate" (id, "routeId", "costType", currency, amount, "effectiveFrom", active, notes, "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  c."routeId",
  'CLEARING_AND_INSPECTION_PER_STEM',
  c.currency,
  c.amount + COALESCE(i.amount, 0),
  now(),
  true,
  'Samengevoegd uit losse clearing- en inspection-tarieven',
  now(),
  now()
FROM "DdpCostRate" c
LEFT JOIN "DdpCostRate" i
  ON i."routeId" = c."routeId"
  AND i."costType" = 'INSPECTION_PER_STEM'
  AND i.active = true
WHERE c."costType" = 'CLEARING_PER_STEM'
  AND c.active = true;

-- Routes that had only an INSPECTION_PER_STEM rate (no matching
-- CLEARING_PER_STEM row), which the join above would otherwise miss.
INSERT INTO "DdpCostRate" (id, "routeId", "costType", currency, amount, "effectiveFrom", active, notes, "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  i."routeId",
  'CLEARING_AND_INSPECTION_PER_STEM',
  i.currency,
  i.amount,
  now(),
  true,
  'Samengevoegd uit losse clearing- en inspection-tarieven (alleen inspection was ingesteld)',
  now(),
  now()
FROM "DdpCostRate" i
WHERE i."costType" = 'INSPECTION_PER_STEM'
  AND i.active = true
  AND NOT EXISTS (
    SELECT 1 FROM "DdpCostRate" c
    WHERE c."routeId" = i."routeId" AND c."costType" = 'CLEARING_PER_STEM' AND c.active = true
  );

-- Deactivate the old separate rows now that they've been consolidated.
UPDATE "DdpCostRate"
SET active = false
WHERE "costType" IN ('CLEARING_PER_STEM', 'INSPECTION_PER_STEM')
  AND active = true;
