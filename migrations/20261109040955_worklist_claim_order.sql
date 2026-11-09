CREATE TABLE `worklist` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`live` integer NOT NULL,
	`claimed_at` text,
	`lease_id` text,
	`lease_holder` text,
	`lease_expires_at` text,
	`last_worked_at` text,
	`last_worked_by` text,
	`last_note` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "worklist_lease_whole" CHECK(("worklist"."lease_id" is null) = ("worklist"."lease_holder" is null) and ("worklist"."lease_id" is null) = ("worklist"."lease_expires_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worklist_lease_id_unique` ON `worklist` (`lease_id`);--> statement-breakpoint
CREATE INDEX `worklist_claim_order_idx` ON `worklist` (`live`,`claimed_at`,`created_at`,`entry_id`);