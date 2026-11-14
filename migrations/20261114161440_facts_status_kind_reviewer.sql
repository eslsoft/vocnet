CREATE INDEX `facts_status_kind_reviewer_idx` ON `facts` (`status`,`kind`,json_extract("review", '$.reviewer'));
