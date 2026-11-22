DROP INDEX `public_sense_topics_frequency_idx`;--> statement-breakpoint
DROP INDEX `public_sense_topics_level_idx`;--> statement-breakpoint
ALTER TABLE `public_sense_topics` ADD `specialized` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `public_sense_topics_lemma_idx` ON `public_sense_topics` (`topic_id`,`specialized`,`lemma`,`sense_id`);--> statement-breakpoint
CREATE INDEX `public_sense_topics_frequency_idx` ON `public_sense_topics` (`topic_id`,`specialized`,`frequency_order`,`lemma`,`sense_id`);--> statement-breakpoint
CREATE INDEX `public_sense_topics_level_idx` ON `public_sense_topics` (`topic_id`,`specialized`,`level_order`,`lemma`,`sense_id`);