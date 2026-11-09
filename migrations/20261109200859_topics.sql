CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name_en` text NOT NULL,
	`name_zh` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `topics_parent_idx` ON `topics` (`parent_id`,`position`);