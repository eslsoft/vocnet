ALTER TABLE `facts` ADD `revalidate_since` text;--> statement-breakpoint
CREATE INDEX `facts_revalidate_idx` ON `facts` (`revalidate_since`) WHERE revalidate_since is not null;