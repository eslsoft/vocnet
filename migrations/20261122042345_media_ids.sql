-- The stored views hold a picture's media id, not its URL (docs/design.md, Media): a read composes
-- the URL from MEDIA_BASE_URL. Until now a picture was stored as the path `/v1/media/<id>`:
-- `"url":"/v1/media/<id>"` in an entry document and `"image_url":"/v1/media/<id>"` (or null) in
-- every summary. They become `"image_id":"<id>"` and `"image_id":null`, in the same key position,
-- so each row is byte for byte what a rebuild writes now. The views are rewritten in place rather
-- than cleared and rebuilt, which would cost every entry. The digests stay: a digest only has to
-- change when the document does, and a read's ETag also covers the media base.
UPDATE `public_entries` SET
  `document` = replace(replace(replace(`document`, '"url":"/v1/media/', '"image_id":"'), '"image_url":"/v1/media/', '"image_id":"'), '"image_url":null', '"image_id":null'),
  `summary` = replace(replace(`summary`, '"image_url":"/v1/media/', '"image_id":"'), '"image_url":null', '"image_id":null');--> statement-breakpoint
UPDATE `public_sense_topics` SET
  `summary` = replace(replace(`summary`, '"image_url":"/v1/media/', '"image_id":"'), '"image_url":null', '"image_id":null');--> statement-breakpoint
UPDATE `public_hypernyms` SET
  `summary` = replace(replace(`summary`, '"image_url":"/v1/media/', '"image_id":"'), '"image_url":null', '"image_id":null');
