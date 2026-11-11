-- Network work moves ahead of meaning and usage, and A1/A2 finish every stage first: rewrite each
-- item's stage from WORK_POLICY, then its rank (tier, stage, band) as rankWorkItemsSql computes it.
UPDATE `work_items` SET `stage` = CASE `type`
  WHEN 'senses' THEN 1 WHEN 'sense_list' THEN 1
  WHEN 'category' THEN 2 WHEN 'parts' THEN 2 WHEN 'synonyms' THEN 2 WHEN 'family' THEN 2 WHEN 'phrases' THEN 2 WHEN 'topics' THEN 2
  WHEN 'translations' THEN 3
  WHEN 'weak_fact' THEN 5
  ELSE 4 END;
--> statement-breakpoint
UPDATE `work_items` SET `rank` = (CASE WHEN (SELECT CASE WHEN `level_rank` IS NOT NULL THEN `level_rank` - 1 WHEN `zipf` IS NULL THEN 7 ELSE 6 END FROM `worklist` WHERE `worklist`.`entry_id` = `work_items`.`entry_id`) < 2 THEN 0 ELSE 48 END) + `stage` * 8 + (SELECT CASE WHEN `level_rank` IS NOT NULL THEN `level_rank` - 1 WHEN `zipf` IS NULL THEN 7 ELSE 6 END FROM `worklist` WHERE `worklist`.`entry_id` = `work_items`.`entry_id`);
