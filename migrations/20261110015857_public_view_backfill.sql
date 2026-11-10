-- Every existing entry starts with a stale public view and no view rows. Reads of a stale entry or
-- sense rebuild it on the spot, the cron rebuilds 100 a run, and an admin drains the rest with
-- POST /manage/v1/public/rebuild. A migration cannot run the TypeScript projection, so it only marks.
UPDATE worklist SET view_revision = revision - 1;
