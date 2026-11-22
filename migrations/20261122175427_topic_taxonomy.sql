-- The topic taxonomy is rebuilt on the learner's dictionary topics of the Oxford Learner's Dictionaries
-- (docs/plans/2026-11-22-topics-and-scenes.md): 19 categories over 89 topics, where a tag names
-- what the sense means, never a scene it turns up in. A sense is tagged with a topic or, when none
-- of a category's topics holds it, with the category itself.
--
-- 1. Each old leaf topic and the topic its tags move to; NULL retracts them. The table lives only
--    for this migration.
CREATE TABLE `_topic_remap` (`old_id` text PRIMARY KEY NOT NULL, `new_id` text);
--> statement-breakpoint
INSERT INTO `_topic_remap` (`old_id`, `new_id`) VALUES
	('ai-data', 'computers'),
	('airport-flying', 'air-travel'),
	('alcohol', 'drinks'),
	('appearance', 'looks'),
	('appliances', 'houses-and-homes'),
	('ball-sports', 'ball-and-racket-sports'),
	('banking', 'money'),
	('bathroom-hygiene', 'houses-and-homes'),
	('biology', 'biology'),
	('birds', 'birds'),
	('body-parts', 'body'),
	('books-reading', 'literature-and-writing'),
	('bus-taxi', 'bus-and-train'),
	('business-trade', 'business'),
	('cafe', 'cooking-and-eating'),
	('charity-volunteering', 'social-issues'),
	('chemistry', 'physics-and-chemistry'),
	('classroom', 'schools'),
	('cleaning-chores', 'houses-and-homes'),
	('clothing', 'clothes-and-fashion'),
	('colours-shapes', 'colours-and-shapes'),
	('communication-styles', 'speaking'),
	('computers', 'computers'),
	('cooking-methods', 'cooking-and-eating'),
	('countryside-village', 'geography'),
	('crime-police', 'crime-and-punishment'),
	('crops-farming', 'farming'),
	('culture-traditions', 'politics-society'),
	('cybersecurity', 'computers'),
	('cycling-walking', 'travel'),
	('daily-routine', NULL),
	('dairy-eggs', 'food'),
	('dentist', 'healthcare'),
	('directions-maps', 'position-and-direction'),
	('drinks', 'drinks'),
	('driving-cars', 'cars-and-roads'),
	('economy-globalisation', 'money'),
	('emotions', 'feelings'),
	('energy-resources', 'environment'),
	('environment-pollution', 'environment'),
	('exams-grades', 'exams-and-qualifications'),
	('fabrics-patterns', 'clothes-and-fashion'),
	('factory-manufacturing', 'business'),
	('family', 'family-and-relationships'),
	('farm-animals', 'mammals-and-others'),
	('fitness-exercise', 'health-and-fitness'),
	('flavours-texture', 'cooking-and-eating'),
	('flowers', 'plants-and-trees'),
	('friends-social', 'family-and-relationships'),
	('fruit', 'food'),
	('fungi-mushrooms', 'plants-and-trees'),
	('furniture', 'houses-and-homes'),
	('games-toys', 'games-toys'),
	('garden-gardening', 'gardens'),
	('government-politics', 'politics'),
	('grains-bread', 'food'),
	('herbs-spices', 'food'),
	('hobbies-crafts', 'hobbies'),
	('holidays-festivals', 'religion-and-festivals'),
	('hospital-doctor', 'healthcare'),
	('hotel', 'holidays'),
	('house-rooms', 'houses-and-homes'),
	('illness-symptoms', 'health-problems'),
	('injury-first-aid', 'health-problems'),
	('insects', 'insects-worms'),
	('internet-web', 'phones-and-internet'),
	('investing', 'money'),
	('job-hunting', 'working-life'),
	('jobs-roles', 'jobs'),
	('kitchen-utensils', 'cooking-and-eating'),
	('landscape-landforms', 'geography'),
	('language-learning', 'language'),
	('law-courts', 'law-and-justice'),
	('life-stages', 'life-stages'),
	('loans-debt', 'money'),
	('luggage-packing', 'holidays'),
	('management', 'business'),
	('marketing-sales', 'business'),
	('martial-arts', 'combat-sports'),
	('mathematics', 'maths-and-measurement'),
	('measurement-units', 'maths-and-measurement'),
	('meat-seafood', 'food'),
	('medicine-pharmacy', 'healthcare'),
	('meetings', 'working-life'),
	('mental-health', 'mental-health'),
	('military-war', 'war-and-conflict'),
	('moving-renting', 'houses-and-homes'),
	('museums-galleries', 'art'),
	('music', 'music'),
	('natural-disasters', 'environment'),
	('neighbourhood', 'towns-and-cities'),
	('news-journalism', 'tv-radio-news'),
	('numbers-quantities', 'maths-and-measurement'),
	('office', 'working-life'),
	('online-shopping', 'shopping'),
	('opinions-attitudes', 'opinion-and-argument'),
	('outdoor-camping', 'holidays'),
	('painting-photography', 'art'),
	('parties-celebrations', 'religion-and-festivals'),
	('passport-customs', 'holidays'),
	('payment-prices', 'money'),
	('personality', 'personal-qualities'),
	('pets', 'mammals-and-others'),
	('phone-calls-messages', 'phones-and-internet'),
	('phones-apps', 'phones-and-internet'),
	('physics', 'physics-and-chemistry'),
	('plant-parts', 'plants-and-trees'),
	('police-emergency', 'law-and-justice'),
	('public-services', 'towns-and-cities'),
	('relationships', 'family-and-relationships'),
	('religion-beliefs', 'religion-and-festivals'),
	('repairs-diy', 'tools-and-repairs'),
	('research-experiments', 'scientific-research'),
	('restaurant-ordering', 'cooking-and-eating'),
	('returns-complaints', 'shopping'),
	('saving-budget', 'money'),
	('sea-life', 'fish-and-shellfish'),
	('seasons-climate', 'weather'),
	('shoes-accessories', 'clothes-and-fashion'),
	('shopping-mall', 'shopping'),
	('sightseeing', 'holidays'),
	('small-talk', 'speaking'),
	('snacks-sweets', 'food'),
	('social-issues', 'social-issues'),
	('social-media', 'phones-and-internet'),
	('software-programming', 'computers'),
	('space-astronomy', 'space'),
	('stationery', 'schools'),
	('streets-buildings', 'towns-and-cities'),
	('subjects', 'teaching-and-learning'),
	('supermarket', 'shopping'),
	('tax-insurance', 'money'),
	('theatre-dance', 'film-and-theatre'),
	('thinking-memory', 'thinking-and-memory'),
	('time-dates', 'time'),
	('train-subway', 'bus-and-train'),
	('trees', 'plants-and-trees'),
	('tv-film', 'film-and-theatre'),
	('university', 'higher-education'),
	('urban-development', 'towns-and-cities'),
	('vegetables', 'food'),
	('water-bodies', 'geography'),
	('water-sports', 'water-sports'),
	('weather', 'weather'),
	('wild-animals', 'mammals-and-others'),
	('winter-sports', 'winter-sports'),
	('workplace-relations', 'working-life');
--> statement-breakpoint
-- 2. Every live tag is judged again under the new rubric, so the entries owning a tagged sense are
--    stale: their work and public views rebuild. So are the entries whose senses passed the topics
--    slot, since the passes judged the old taxonomy. This runs while the tags still name old topics.
UPDATE `worklist` SET `revision` = `revision` + 1
WHERE `entry_id` IN (
	SELECT `senses`.`entry_id` FROM `senses` JOIN `facts` ON `facts`.`subject_id` = `senses`.`id`
	WHERE `facts`.`kind` = 'topic' AND `facts`.`status` IN ('pending', 'published')
	UNION
	SELECT `entry_id` FROM `work_passes` WHERE `type` = 'topics'
);
--> statement-breakpoint
-- 3. A tag whose topic has no successor is retracted, and so is every tag but the earliest of a
--    sense whose tags move to the same topic ("fruit" and "vegetables" both become "food").
UPDATE `facts` SET `status` = 'retracted', `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `facts`.`kind` = 'topic' AND `facts`.`status` IN ('pending', 'published') AND (
	(SELECT `new_id` FROM `_topic_remap` WHERE `old_id` = json_extract(`facts`.`payload`, '$.topic_id')) IS NULL
	OR EXISTS (
		SELECT 1 FROM `facts` AS `earlier`
		WHERE `earlier`.`kind` = 'topic' AND `earlier`.`status` IN ('pending', 'published')
			AND `earlier`.`subject_id` = `facts`.`subject_id`
			AND (SELECT `new_id` FROM `_topic_remap` WHERE `old_id` = json_extract(`earlier`.`payload`, '$.topic_id'))
				= (SELECT `new_id` FROM `_topic_remap` WHERE `old_id` = json_extract(`facts`.`payload`, '$.topic_id'))
			AND (`earlier`.`created_at` < `facts`.`created_at` OR (`earlier`.`created_at` = `facts`.`created_at` AND `earlier`.`id` < `facts`.`id`))
	)
);
--> statement-breakpoint
-- 4. The other live tags name their new topic and return to pending; the old review stays as the
--    record of the old verdict until the new review replaces it. The timestamps predate the
--    reconcile cutoff, so its next runs enqueue them.
UPDATE `facts` SET
	`payload` = json_set(`payload`, '$.topic_id', (SELECT `new_id` FROM `_topic_remap` WHERE `old_id` = json_extract(`facts`.`payload`, '$.topic_id'))),
	`content_key` = (SELECT `new_id` FROM `_topic_remap` WHERE `old_id` = json_extract(`facts`.`payload`, '$.topic_id')),
	`status` = 'pending',
	`review_enqueued_at` = NULL,
	`updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
WHERE `facts`.`kind` = 'topic' AND `facts`.`status` IN ('pending', 'published');
--> statement-breakpoint
-- 5. The topics slot is worked again against the new taxonomy: its passes go, and its work items
--    start over.
DELETE FROM `work_passes` WHERE `type` = 'topics';
--> statement-breakpoint
UPDATE `work_items` SET `attempts` = 0, `worked` = false, `found_none` = false WHERE `type` = 'topics';
--> statement-breakpoint
DROP TABLE `_topic_remap`;
--> statement-breakpoint
-- 6. The taxonomy: categories first, so every topic's parent exists. A row whose id the old
--    taxonomy used keeps its picture.
INSERT INTO `topics` (`id`, `parent_id`, `name_en`, `name_zh`, `position`) VALUES
	('people', NULL, 'People', '人物', 0),
	('appearance', NULL, 'Appearance', '外貌', 1),
	('health', NULL, 'Health', '健康', 2),
	('food-and-drink', NULL, 'Food and drink', '饮食', 3),
	('homes-and-buildings', NULL, 'Homes and buildings', '居家与建筑', 4),
	('education', NULL, 'Education', '教育', 5),
	('work-and-business', NULL, 'Work and business', '工作与商业', 6),
	('travel', NULL, 'Travel and transport', '旅行与交通', 7),
	('leisure', NULL, 'Leisure', '休闲', 8),
	('sport', NULL, 'Sport', '运动', 9),
	('culture', NULL, 'Culture', '文化', 10),
	('communication', NULL, 'Communication', '交流', 11),
	('thinking-expressing', NULL, 'Thinking and expressing', '思维与表达', 12),
	('natural-world', NULL, 'The natural world', '自然', 13),
	('animals', NULL, 'Animals', '动物', 14),
	('science-technology', NULL, 'Science and technology', '科学与技术', 15),
	('politics-society', NULL, 'Politics and society', '政治与社会', 16),
	('time-space', NULL, 'Time and space', '时间与空间', 17),
	('concepts', NULL, 'General concepts', '概念', 18)
ON CONFLICT (`id`) DO UPDATE SET `parent_id` = excluded.`parent_id`, `name_en` = excluded.`name_en`, `name_zh` = excluded.`name_zh`, `position` = excluded.`position`;
--> statement-breakpoint
INSERT INTO `topics` (`id`, `parent_id`, `name_en`, `name_zh`, `position`) VALUES
	('family-and-relationships', 'people', 'Family and relationships', '家庭与关系', 0),
	('feelings', 'people', 'Feelings', '情感', 1),
	('life-stages', 'people', 'Life stages', '人生阶段', 2),
	('personal-qualities', 'people', 'Personal qualities', '个人品质', 3),
	('looks', 'appearance', 'Looks and grooming', '长相与打扮', 0),
	('body', 'appearance', 'Body', '身体', 1),
	('clothes-and-fashion', 'appearance', 'Clothes and fashion', '服装与时尚', 2),
	('colours-and-shapes', 'appearance', 'Colours and shapes', '颜色与形状', 3),
	('health-and-fitness', 'health', 'Health and fitness', '健康与健身', 0),
	('health-problems', 'health', 'Health problems', '疾病与伤痛', 1),
	('healthcare', 'health', 'Healthcare', '医疗', 2),
	('mental-health', 'health', 'Mental health', '心理健康', 3),
	('disability', 'health', 'Disability', '残障', 4),
	('cooking-and-eating', 'food-and-drink', 'Cooking and eating', '烹饪与用餐', 0),
	('drinks', 'food-and-drink', 'Drinks', '饮品', 1),
	('food', 'food-and-drink', 'Food', '食物', 2),
	('houses-and-homes', 'homes-and-buildings', 'Houses and homes', '住房与家居', 0),
	('buildings', 'homes-and-buildings', 'Buildings', '建筑', 1),
	('gardens', 'homes-and-buildings', 'Gardens', '花园与园艺', 2),
	('towns-and-cities', 'homes-and-buildings', 'Towns and cities', '城镇与城市', 3),
	('tools-and-repairs', 'homes-and-buildings', 'Tools and repairs', '工具与维修', 4),
	('schools', 'education', 'Schools', '中小学', 0),
	('teaching-and-learning', 'education', 'Teaching and learning', '教与学', 1),
	('exams-and-qualifications', 'education', 'Exams and qualifications', '考试与学历', 2),
	('higher-education', 'education', 'Higher education', '高等教育', 3),
	('jobs', 'work-and-business', 'Jobs', '职业', 0),
	('working-life', 'work-and-business', 'Working life', '职场生活', 1),
	('business', 'work-and-business', 'Business', '商业', 2),
	('money', 'work-and-business', 'Money and the economy', '金钱与经济', 3),
	('holidays', 'travel', 'Holidays and accommodation', '度假与住宿', 0),
	('air-travel', 'travel', 'Air travel', '航空', 1),
	('bus-and-train', 'travel', 'Buses and trains', '公交与铁路', 2),
	('cars-and-roads', 'travel', 'Cars and roads', '汽车与道路', 3),
	('water-transport', 'travel', 'Water transport', '水上交通', 4),
	('games-toys', 'leisure', 'Games and toys', '游戏与玩具', 0),
	('hobbies', 'leisure', 'Hobbies and crafts', '爱好与手工', 1),
	('shopping', 'leisure', 'Shopping', '购物', 2),
	('ball-and-racket-sports', 'sport', 'Ball and racket sports', '球类与拍类运动', 0),
	('water-sports', 'sport', 'Water sports', '水上运动', 1),
	('winter-sports', 'sport', 'Winter sports', '冰雪运动', 2),
	('combat-sports', 'sport', 'Combat sports', '格斗运动', 3),
	('athletics-and-other-sports', 'sport', 'Athletics and other sports', '田径与其他运动', 4),
	('art', 'culture', 'Art', '美术', 0),
	('film-and-theatre', 'culture', 'Film and theatre', '影视与戏剧', 1),
	('literature-and-writing', 'culture', 'Literature and writing', '文学与写作', 2),
	('music', 'culture', 'Music', '音乐', 3),
	('tv-radio-news', 'culture', 'TV, radio and news', '广播电视与新闻', 4),
	('language', 'communication', 'Language', '语言', 0),
	('phones-and-internet', 'communication', 'Phones, email and the internet', '电话、邮件与互联网', 1),
	('speaking', 'communication', 'Speaking and conversation', '说话与交谈', 2),
	('thinking-and-memory', 'thinking-expressing', 'Thinking and memory', '思考与记忆', 0),
	('discussion-and-agreement', 'thinking-expressing', 'Discussion and agreement', '讨论与协商', 1),
	('doubt-and-certainty', 'thinking-expressing', 'Doubt and certainty', '确定与可能', 2),
	('opinion-and-argument', 'thinking-expressing', 'Opinion and argument', '观点与争论', 3),
	('permission-and-obligation', 'thinking-expressing', 'Permission and obligation', '许可与义务', 4),
	('preferences-and-decisions', 'thinking-expressing', 'Preferences and decisions', '喜好与决定', 5),
	('suggestions-and-advice', 'thinking-expressing', 'Suggestions and advice', '建议', 6),
	('geography', 'natural-world', 'Geography', '地理', 0),
	('weather', 'natural-world', 'Weather', '天气', 1),
	('environment', 'natural-world', 'The environment', '环境', 2),
	('plants-and-trees', 'natural-world', 'Plants and trees', '植物', 3),
	('farming', 'natural-world', 'Farming', '农业', 4),
	('mammals-and-others', 'animals', 'Mammals and other animals', '兽类与其他动物', 0),
	('birds', 'animals', 'Birds', '鸟类', 1),
	('fish-and-shellfish', 'animals', 'Fish and sea creatures', '鱼类与水生动物', 2),
	('insects-worms', 'animals', 'Insects and small creatures', '昆虫与小动物', 3),
	('biology', 'science-technology', 'Biology', '生物', 0),
	('physics-and-chemistry', 'science-technology', 'Physics and chemistry', '物理与化学', 1),
	('maths-and-measurement', 'science-technology', 'Maths and measurement', '数学与计量', 2),
	('scientific-research', 'science-technology', 'Scientific research', '科学研究', 3),
	('computers', 'science-technology', 'Computers', '计算机', 4),
	('engineering', 'science-technology', 'Engineering and machines', '工程与机器', 5),
	('politics', 'politics-society', 'Politics', '政治', 0),
	('law-and-justice', 'politics-society', 'Law and justice', '法律与司法', 1),
	('crime-and-punishment', 'politics-society', 'Crime and punishment', '犯罪与惩罚', 2),
	('war-and-conflict', 'politics-society', 'War and conflict', '战争与冲突', 3),
	('social-issues', 'politics-society', 'Social issues', '社会问题', 4),
	('people-in-society', 'politics-society', 'People in society', '社会群体', 5),
	('religion-and-festivals', 'politics-society', 'Religion and festivals', '宗教与节日', 6),
	('time', 'time-space', 'Time', '时间', 0),
	('position-and-direction', 'time-space', 'Position and direction', '位置与方向', 1),
	('history', 'time-space', 'History', '历史', 2),
	('space', 'time-space', 'Space', '太空', 3),
	('describing-things', 'concepts', 'Describing things', '描述事物', 0),
	('senses-and-sounds', 'concepts', 'Senses and sounds', '感官与声音', 1),
	('change-cause-effect', 'concepts', 'Change, cause and effect', '变化与因果', 2),
	('danger', 'concepts', 'Danger and safety', '危险与安全', 3),
	('difficulty-and-failure', 'concepts', 'Difficulty and failure', '困难与失败', 4),
	('success', 'concepts', 'Success', '成功', 5)
ON CONFLICT (`id`) DO UPDATE SET `parent_id` = excluded.`parent_id`, `name_en` = excluded.`name_en`, `name_zh` = excluded.`name_zh`, `position` = excluded.`position`;
--> statement-breakpoint
-- 7. The old topics go, their leaves before their categories.
DELETE FROM `topics` WHERE `parent_id` IS NOT NULL AND `id` NOT IN ('people', 'appearance', 'health', 'food-and-drink', 'homes-and-buildings', 'education', 'work-and-business', 'travel', 'leisure', 'sport', 'culture', 'communication', 'thinking-expressing', 'natural-world', 'animals', 'science-technology', 'politics-society', 'time-space', 'concepts', 'family-and-relationships', 'feelings', 'life-stages', 'personal-qualities', 'looks', 'body', 'clothes-and-fashion', 'colours-and-shapes', 'health-and-fitness', 'health-problems', 'healthcare', 'mental-health', 'disability', 'cooking-and-eating', 'drinks', 'food', 'houses-and-homes', 'buildings', 'gardens', 'towns-and-cities', 'tools-and-repairs', 'schools', 'teaching-and-learning', 'exams-and-qualifications', 'higher-education', 'jobs', 'working-life', 'business', 'money', 'holidays', 'air-travel', 'bus-and-train', 'cars-and-roads', 'water-transport', 'games-toys', 'hobbies', 'shopping', 'ball-and-racket-sports', 'water-sports', 'winter-sports', 'combat-sports', 'athletics-and-other-sports', 'art', 'film-and-theatre', 'literature-and-writing', 'music', 'tv-radio-news', 'language', 'phones-and-internet', 'speaking', 'thinking-and-memory', 'discussion-and-agreement', 'doubt-and-certainty', 'opinion-and-argument', 'permission-and-obligation', 'preferences-and-decisions', 'suggestions-and-advice', 'geography', 'weather', 'environment', 'plants-and-trees', 'farming', 'mammals-and-others', 'birds', 'fish-and-shellfish', 'insects-worms', 'biology', 'physics-and-chemistry', 'maths-and-measurement', 'scientific-research', 'computers', 'engineering', 'politics', 'law-and-justice', 'crime-and-punishment', 'war-and-conflict', 'social-issues', 'people-in-society', 'religion-and-festivals', 'time', 'position-and-direction', 'history', 'space', 'describing-things', 'senses-and-sounds', 'change-cause-effect', 'danger', 'difficulty-and-failure', 'success');
--> statement-breakpoint
DELETE FROM `topics` WHERE `id` NOT IN ('people', 'appearance', 'health', 'food-and-drink', 'homes-and-buildings', 'education', 'work-and-business', 'travel', 'leisure', 'sport', 'culture', 'communication', 'thinking-expressing', 'natural-world', 'animals', 'science-technology', 'politics-society', 'time-space', 'concepts', 'family-and-relationships', 'feelings', 'life-stages', 'personal-qualities', 'looks', 'body', 'clothes-and-fashion', 'colours-and-shapes', 'health-and-fitness', 'health-problems', 'healthcare', 'mental-health', 'disability', 'cooking-and-eating', 'drinks', 'food', 'houses-and-homes', 'buildings', 'gardens', 'towns-and-cities', 'tools-and-repairs', 'schools', 'teaching-and-learning', 'exams-and-qualifications', 'higher-education', 'jobs', 'working-life', 'business', 'money', 'holidays', 'air-travel', 'bus-and-train', 'cars-and-roads', 'water-transport', 'games-toys', 'hobbies', 'shopping', 'ball-and-racket-sports', 'water-sports', 'winter-sports', 'combat-sports', 'athletics-and-other-sports', 'art', 'film-and-theatre', 'literature-and-writing', 'music', 'tv-radio-news', 'language', 'phones-and-internet', 'speaking', 'thinking-and-memory', 'discussion-and-agreement', 'doubt-and-certainty', 'opinion-and-argument', 'permission-and-obligation', 'preferences-and-decisions', 'suggestions-and-advice', 'geography', 'weather', 'environment', 'plants-and-trees', 'farming', 'mammals-and-others', 'birds', 'fish-and-shellfish', 'insects-worms', 'biology', 'physics-and-chemistry', 'maths-and-measurement', 'scientific-research', 'computers', 'engineering', 'politics', 'law-and-justice', 'crime-and-punishment', 'war-and-conflict', 'social-issues', 'people-in-society', 'religion-and-festivals', 'time', 'position-and-direction', 'history', 'space', 'describing-things', 'senses-and-sounds', 'change-cause-effect', 'danger', 'difficulty-and-failure', 'success');
--> statement-breakpoint
-- 8. No tag is published now, so the public views show none: every sense's topics are emptied in
--    place, and the topic listings are cleared. A rebuild writes the same. A changed document takes a
--    new digest, so a read's ETag changes with it; the next rebuild replaces it with the real one.
UPDATE `public_entries` SET
	`document` = json_set(`document`, '$.meanings', json((
		SELECT json_group_array(json(json_set(`meaning`.`value`, '$.senses', json((
			SELECT json_group_array(json(json_set(`sense`.`value`, '$.topics', json('[]'))))
			FROM json_each(`meaning`.`value`, '$.senses') AS `sense`
		)))))
		FROM json_each(`public_entries`.`document`, '$.meanings') AS `meaning`
	))),
	`digest` = lower(hex(randomblob(32)))
WHERE `entry_id` IN (SELECT `entry_id` FROM `public_sense_topics`)
	OR EXISTS (SELECT 1 FROM json_tree(`public_entries`.`document`) WHERE `key` = 'topics' AND `type` = 'array' AND json_array_length(`value`) > 0);
--> statement-breakpoint
DELETE FROM `public_sense_topics`;
