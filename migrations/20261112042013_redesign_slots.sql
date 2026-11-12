-- The data migration (scripts/migrate/redesign.py) has rewritten the reshaped kinds and given every
-- live fact its slot, so each slot now has one holder and one pending correction at most.
CREATE UNIQUE INDEX `facts_slot_holder_idx` ON `facts` (`kind`,`subject_id`,`slot`) WHERE slot is not null and (status = 'published' or (status = 'pending' and supersedes_id is null));--> statement-breakpoint
CREATE UNIQUE INDEX `facts_slot_pending_idx` ON `facts` (`kind`,`subject_id`,`slot`) WHERE slot is not null and status = 'pending';
