CREATE TABLE `entry_work` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`last_worked_at` text NOT NULL,
	`last_worked_by` text NOT NULL,
	`last_note` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `work_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`holder` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_leases_entry_id_unique` ON `work_leases` (`entry_id`);