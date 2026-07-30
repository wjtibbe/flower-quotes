-- Seeds the centrally managed "Aanvullende kostensoorten" vocabulary and
-- backfills existing DdpCostRate rows to reference it by id, replacing the
-- free-text-only "name" field as the source of truth for terminology.
--
-- Idempotent: every insert is ON CONFLICT ("normalizedName") DO NOTHING, and
-- every update only ever touches rows where additionalCostTypeId IS NULL, so
-- re-running this migration (or a future one that repeats the same seed
-- step) is always safe.
--
-- Never touches amount/category/rateUnit/currency/effectiveFrom/effectiveTo
-- on any DdpCostRate row - only the new additionalCostTypeId link is set,
-- so quote pricing math is numerically unaffected by this migration.

-- ------------------------------------------------------------------
-- 1) Seed the 3 canonical types from the business spec.
--    "Inspection" defaults to FLAT (a fixed amount, not scaled by stems/
--    boxes) as the closest existing CostRateUnit to "per shipment" - the
--    engine has no per-shipment unit today and this migration must not
--    change calculation semantics (see the pricing-engine comment on
--    CostRateUnit); the per-route rateUnit stays independently editable.
-- ------------------------------------------------------------------
insert into "AdditionalCostType" (id, name, "normalizedName", category, "defaultUnit", "isActive", "createdAt", "updatedAt")
values
  (gen_random_uuid(), 'Clearing', 'clearing', 'CLEARING', 'PER_STEM', true, now(), now()),
  (gen_random_uuid(), 'Handling', 'handling', 'HANDLING', 'PER_BOX', true, now(), now()),
  (gen_random_uuid(), 'Inspection', 'inspection', 'INSPECTION', 'FLAT', true, now(), now())
on conflict ("normalizedName") do nothing;

-- ------------------------------------------------------------------
-- 2) Link existing rows whose name is a known synonym of one of the 3
--    canonical types above (case/whitespace-insensitive exact match).
-- ------------------------------------------------------------------
update "DdpCostRate" r
set "additionalCostTypeId" = t.id
from "AdditionalCostType" t
where t."normalizedName" = 'clearing'
  and lower(trim(r.name)) in ('clearing', 'inklaring', 'customs clearance', 'douane')
  and r."additionalCostTypeId" is null;

update "DdpCostRate" r
set "additionalCostTypeId" = t.id
from "AdditionalCostType" t
where t."normalizedName" = 'handling'
  and lower(trim(r.name)) in ('handling', 'handling fee', 'afhandeling')
  and r."additionalCostTypeId" is null;

update "DdpCostRate" r
set "additionalCostTypeId" = t.id
from "AdditionalCostType" t
where t."normalizedName" = 'inspection'
  and lower(trim(r.name)) in ('inspection', 'inspectie', 'quality inspection')
  and r."additionalCostTypeId" is null;

-- ------------------------------------------------------------------
-- 3) Anything left over (e.g. the combined legacy "Clearing & inspection",
--    or "Documentatie") is NOT a known synonym and must never be silently
--    folded into one of the 3 types above - it gets its own canonical type,
--    created from its existing cleaned name/category/unit, preserving its
--    distinct historical meaning so a human can review/consolidate it later
--    via Settings -> Aanvullende kostensoorten if desired.
-- ------------------------------------------------------------------
insert into "AdditionalCostType" (id, name, "normalizedName", category, "defaultUnit", "isActive", "createdAt", "updatedAt")
select
  gen_random_uuid(),
  min(trim(r.name)),
  lower(trim(r.name)),
  r.category,
  coalesce(r."rateUnit", 'FLAT'),
  true,
  now(),
  now()
from "DdpCostRate" r
where r."additionalCostTypeId" is null
  and r.name is not null
  and r.category is not null
group by lower(trim(r.name)), r.category, coalesce(r."rateUnit", 'FLAT')
on conflict ("normalizedName") do nothing;

update "DdpCostRate" r
set "additionalCostTypeId" = t.id
from "AdditionalCostType" t
where r."additionalCostTypeId" is null
  and r.name is not null
  and t."normalizedName" = lower(trim(r.name));
