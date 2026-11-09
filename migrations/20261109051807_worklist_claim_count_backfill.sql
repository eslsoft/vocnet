-- An entry claimed before claim_count existed counts as claimed once, so it gets its second pass
-- ahead of never-claimed entries.
UPDATE `worklist` SET `claim_count` = 1 WHERE `claimed_at` IS NOT NULL;
