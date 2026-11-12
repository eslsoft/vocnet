-- The query planner had no statistics, so it read every relation fact by kind instead of the few a
-- snapshot names by subject or object (about 140 ms per entry). PRAGMA optimize collects them, as
-- D1 recommends after a schema change.
PRAGMA optimize;
