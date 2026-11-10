-- The full-text index of public_search (server/domain/search.ts). It stores no text of its own:
-- public_search is its external content, and these triggers keep the index in step with it, so a
-- view rebuild only writes public_search rows. The index is derived like the rest of the view, so
-- it can be dropped (as `wrangler d1 export` requires of a virtual table) and restored with this
-- file followed by INSERT INTO public_search_fts(public_search_fts) VALUES ('rebuild').
CREATE VIRTUAL TABLE `public_search_fts` USING fts5(
	`body`,
	content = 'public_search',
	content_rowid = 'id',
	tokenize = 'unicode61 remove_diacritics 2'
);--> statement-breakpoint
CREATE TRIGGER `public_search_indexed` AFTER INSERT ON `public_search` BEGIN
	INSERT INTO `public_search_fts` (`rowid`, `body`) VALUES (new.`id`, new.`body`);
END;--> statement-breakpoint
CREATE TRIGGER `public_search_unindexed` AFTER DELETE ON `public_search` BEGIN
	INSERT INTO `public_search_fts` (`public_search_fts`, `rowid`, `body`) VALUES ('delete', old.`id`, old.`body`);
END;
