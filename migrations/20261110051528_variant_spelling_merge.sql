-- One word has one entry, and the British spelling is the main one (docs/design.md, Spelling
-- variants). Each pair below is (main, variant): a pure spelling variant, not a word of its own.
-- Homographs and words of their own are left as entries and judged as words: a/an, among/amongst,
-- AM and PM/pm (abbreviations with meanings of their own), backward/backwards, forward/forwards,
-- dependent/dependant, practice/practise, licence/license, program/programme, prise/prize,
-- metre/meter, gram/gramme, kilogram/kilogramme, dialog/dialogue, and story/storey.
--
-- For each pair whose two entries are live, the variant's entry fact is retracted, so its senses
-- and facts leave the public view, and the main entry gets a pending `variant` form fact naming the
-- variant unless it holds one, which review publishes (the reconcile cron enqueues it: it predates
-- the cutoff). Nothing moves across entries; the producers refill what the main entry lacks. Both
-- entries are marked stale first, as data migrations must (Backfill and rebuild), so their views
-- are rebuilt and their rows rescored.
CREATE TABLE `variant_merge` (`main_id` text NOT NULL, `variant_id` text NOT NULL, `variant` text NOT NULL);
--> statement-breakpoint
INSERT INTO `variant_merge` (`main_id`, `variant_id`, `variant`)
SELECT `main`.`id`, `variant`.`id`, `variant`.`lemma`
FROM (VALUES
	('acknowledgement', 'acknowledgment'),
	('afterwards', 'afterward'),
	('aeroplane', 'airplane'),
	('all right', 'alright'),
	('behaviour', 'behavior'),
	('café', 'cafe'),
	('colour', 'color'),
	('colourant', 'colorant'),
	('criticise', 'criticize'),
	('Dr', 'Dr.'),
	('email', 'e-mail'),
	('email', 'E-mail'),
	('favourite', 'favorite'),
	('fibre', 'fiber'),
	('fulfil', 'fulfill'),
	('grey', 'gray'),
	('harbour', 'harbor'),
	('humour', 'humor'),
	('internet', 'Internet'),
	('jewellery', 'jewelry'),
	('maths', 'math'),
	('mum', 'mom'),
	('mommy', 'mommie'),
	('Mr', 'Mr.'),
	('Mrs', 'Mrs.'),
	('neighbour', 'neighbor'),
	('offence', 'offense'),
	('OK', 'okay'),
	('organisation', 'organization'),
	('plough', 'plow'),
	('theatre', 'theater'),
	('T-shirt', 'tee-shirt'),
	('yoghurt', 'yogurt'),
	('yoghurt', 'yoghourt'),
	('a.m.', 'A.M.'),
	('p.m.', 'P.M.'),
	('agonise', 'agonize'),
	('analyse', 'analyze'),
	('apologise', 'apologize'),
	('archaeologist', 'archeologist'),
	('ardour', 'ardor'),
	('armoury', 'armory'),
	('authorise', 'authorize'),
	('carbonise', 'carbonize'),
	('catalogue', 'catalog'),
	('categorisation', 'categorization'),
	('categorise', 'categorize'),
	('centimetre', 'centimeter'),
	('centralised', 'centralized'),
	('centre', 'center'),
	('characterisation', 'characterization'),
	('characterise', 'characterize'),
	('civilisation', 'civilization'),
	('colourful', 'colorful'),
	('computerise', 'computerize'),
	('counselling', 'counseling'),
	('crystallisation', 'crystallization'),
	('crystallise', 'crystallize'),
	('decentralise', 'decentralize'),
	('defence', 'defense'),
	('dehumanise', 'dehumanize'),
	('diarrhoea', 'diarrhea'),
	('digitalisation', 'digitalization'),
	('digitalise', 'digitalize'),
	('disorganised', 'disorganized'),
	('economise', 'economize'),
	('emphasise', 'emphasize'),
	('encyclopaedia', 'encyclopedia'),
	('endeavour', 'endeavor'),
	('familiarise', 'familiarize'),
	('favour', 'favor'),
	('favourable', 'favorable'),
	('favourably', 'favorably'),
	('flavour', 'flavor'),
	('generalisation', 'generalization'),
	('generalise', 'generalize'),
	('glamorous', 'glamourous'),
	('honour', 'honor'),
	('honourable', 'honorable'),
	('hospitalise', 'hospitalize'),
	('humanise', 'humanize'),
	('idolise', 'idolize'),
	('industrialise', 'industrialize'),
	('italicise', 'italicize'),
	('jeopardise', 'jeopardize'),
	('jeweller', 'jeweler'),
	('kilometre', 'kilometer'),
	('labour', 'labor'),
	('labourer', 'laborer'),
	('lacklustre', 'lackluster'),
	('litre', 'liter'),
	('materialisation', 'materialization'),
	('materialise', 'materialize'),
	('mechanise', 'mechanize'),
	('medieval', 'mediaeval'),
	('memorise', 'memorize'),
	('micrometre', 'micrometer'),
	('millimetre', 'millimeter'),
	('minimise', 'minimize'),
	('modernisation', 'modernization'),
	('modernise', 'modernize'),
	('neighbourhood', 'neighborhood'),
	('neighbouring', 'neighboring'),
	('neutralisation', 'neutralization'),
	('neutralise', 'neutralize'),
	('organise', 'organize'),
	('organised', 'organized'),
	('overemphasise', 'overemphasize'),
	('paralyse', 'paralyze'),
	('patronise', 'patronize'),
	('penalise', 'penalize'),
	('personalisation', 'personalization'),
	('personalise', 'personalize'),
	('phoenix', 'phenix'),
	('popularise', 'popularize'),
	('publicise', 'publicize'),
	('realisation', 'realization'),
	('realise', 'realize'),
	('recognise', 'recognize'),
	('reorganise', 'reorganize'),
	('revolutionise', 'revolutionize'),
	('rumour', 'rumor'),
	('scrutinise', 'scrutinize'),
	('socialise', 'socialize'),
	('specialise', 'specialize'),
	('sports centre', 'sports center'),
	('stabilise', 'stabilize'),
	('summarise', 'summarize'),
	('sympathise', 'sympathize'),
	('tantalise', 'tantalize'),
	('tranquilise', 'tranquilize'),
	('traveller', 'traveler'),
	('tumour', 'tumor'),
	('unauthorised', 'unauthorized'),
	('utilisation', 'utilization'),
	('utilise', 'utilize'),
	('vigour', 'vigor'),
	('well-organised', 'well-organized')
) AS `pair`
JOIN `entries` AS `main` ON `main`.`lemma` = `pair`.`column1`
JOIN `entries` AS `variant` ON `variant`.`lemma` = `pair`.`column2`
WHERE EXISTS (
	SELECT 1 FROM `facts` WHERE `kind` = 'entry' AND `subject_id` = `main`.`id` AND `status` IN ('pending', 'published')
) AND EXISTS (
	SELECT 1 FROM `facts` WHERE `kind` = 'entry' AND `subject_id` = `variant`.`id` AND `status` IN ('pending', 'published')
);
--> statement-breakpoint
UPDATE `worklist`
SET `revision` = `revision` + 1,
	`live` = CASE WHEN `entry_id` IN (SELECT `variant_id` FROM `variant_merge`) THEN 0 ELSE `live` END
WHERE `entry_id` IN (SELECT `main_id` FROM `variant_merge`) OR `entry_id` IN (SELECT `variant_id` FROM `variant_merge`);
--> statement-breakpoint
UPDATE `facts`
SET `status` = 'retracted', `revalidate_since` = NULL, `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `kind` = 'entry' AND `status` IN ('pending', 'published')
	AND `subject_id` IN (SELECT `variant_id` FROM `variant_merge`);
--> statement-breakpoint
INSERT INTO `facts` (`id`, `kind`, `subject_id`, `object_id`, `content_key`, `payload`, `status`, `exclusive`, `author`, `created_at`, `updated_at`)
SELECT
	lower(substr(`uuid`, 1, 8) || '-' || substr(`uuid`, 9, 4) || '-4' || substr(`uuid`, 13, 3) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(`uuid`, 17, 3) || '-' || substr(`uuid`, 21, 12)),
	'form', `main_id`, NULL, 'variant|' || `variant`, json_object('form', `variant`, 'type', 'variant'), 'pending', 0, 'admin:migration',
	strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
FROM (SELECT hex(randomblob(16)) AS `uuid`, `main_id`, `variant` FROM `variant_merge`)
WHERE NOT EXISTS (
	SELECT 1 FROM `facts`
	WHERE `kind` = 'form' AND `subject_id` = `main_id` AND `status` IN ('pending', 'published')
		AND (`content_key` = 'variant|' || `variant` OR substr(`content_key`, 1, length(`variant`) + 9) = 'variant|' || `variant` || '|')
);
--> statement-breakpoint
DROP TABLE `variant_merge`;
