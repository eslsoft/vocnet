-- A gap closure review now weighs the rejected attempts to fill its slot and passes the closure
-- when they were rejected as not fitting, unless the reviewer names a specific value that differs
-- from every one (docs/design.md, Gap closures). Entries stalled on the old review, which rejected
-- every value tried and then the closure, can now close their gaps.
--
-- Every row is stale, and no row keeps the open work of its last claim, so a rescore stalls none
-- and every entry with work is claimable again. Its producer resubmits the closure: a rejected
-- fact holds no content key, so the resubmission is a new fact with a fresh review. A stale row
-- stays claimable; drain the rest with POST /manage/v1/work/rescore.
UPDATE `worklist` SET `revision` = `revision` + 1, `stalled` = 0, `claimed_work` = NULL;
