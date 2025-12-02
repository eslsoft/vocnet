-- 将 user_id 字段从 bigint 类型转换为 UUID 类型
-- 注意：执行前请备份数据库！

-- 背景：user_id 原先是 bigint 类型，现在需要改为 UUID 类型
-- 方案：先创建临时列，迁移数据，然后替换原列

-- ============================================
-- 方案 1: 如果数据库为空或可以清空数据
-- ============================================
-- 直接删除列并重新创建（会丢失数据）
-- ALTER TABLE wordbook DROP COLUMN user_id;
-- ALTER TABLE wordbook ADD COLUMN user_id uuid NOT NULL;
-- 
-- ALTER TABLE learned_word DROP COLUMN user_id;
-- ALTER TABLE learned_word ADD COLUMN user_id uuid NOT NULL;

-- ============================================
-- 方案 2: 保留数据的迁移（推荐）
-- ============================================
-- 注意：这个方案假设你有一个 users 表来映射 bigint ID 到 UUID
-- 如果没有 users 表或映射关系，则只能使用方案1或方案3

-- 示例（需要根据实际情况调整）:
-- UPDATE wordbook w
-- SET user_id_temp = u.uuid
-- FROM users u
-- WHERE w.user_id = u.id;

-- ============================================
-- 方案 3: 生成新的 UUID（会改变 user_id 值）
-- ============================================

-- 步骤 1: 为 wordbook 表添加临时 UUID 列
ALTER TABLE wordbook ADD COLUMN user_id_temp uuid;

-- 步骤 2: 为每个现有的 bigint user_id 生成对应的 UUID
-- 注意：这会生成新的 UUID，与原 bigint 值无关联
UPDATE wordbook SET user_id_temp = gen_random_uuid();

-- 步骤 3: 删除旧的 user_id 列
ALTER TABLE wordbook DROP COLUMN user_id;

-- 步骤 4: 将临时列重命名为 user_id
ALTER TABLE wordbook RENAME COLUMN user_id_temp TO user_id;

-- 步骤 5: 设置 NOT NULL 约束
ALTER TABLE wordbook ALTER COLUMN user_id SET NOT NULL;

-- 步骤 6: 重建索引（根据原有索引结构）
CREATE UNIQUE INDEX IF NOT EXISTS wordbook_user_id_name_key ON wordbook(user_id, name);
CREATE INDEX IF NOT EXISTS wordbook_user_id_idx ON wordbook(user_id);

-- 对 learned_word 表执行相同操作
ALTER TABLE learned_word ADD COLUMN user_id_temp uuid;
UPDATE learned_word SET user_id_temp = gen_random_uuid();
ALTER TABLE learned_word DROP COLUMN user_id;
ALTER TABLE learned_word RENAME COLUMN user_id_temp TO user_id;
ALTER TABLE learned_word ALTER COLUMN user_id SET NOT NULL;

-- 重建 learned_word 的索引
CREATE UNIQUE INDEX IF NOT EXISTS learned_word_user_id_term_language_key ON learned_word(user_id, term, language);
CREATE INDEX IF NOT EXISTS learned_word_user_id_review_next_review_at_idx ON learned_word(user_id, review_next_review_at);

-- 验证转换结果
SELECT 
    table_name, 
    column_name, 
    data_type 
FROM information_schema.columns 
WHERE column_name = 'user_id' 
AND table_schema = 'public'
ORDER BY table_name;
