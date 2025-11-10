package entschema

import (
	"time"

	"github.com/eslsoft/vocnet/internal/entity"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

type Word struct {
	ent.Schema
}

func (Word) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.String("wid").
			NotEmpty().
			Unique().
			Comment("Stable business identifier: {language}:{lemma}"),
		field.String("lemma").
			NotEmpty(),
		field.String("language").
			NotEmpty(),
		field.JSON("phonetics", []entity.Phonetic{}).
			Default([]entity.Phonetic{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.JSON("categories", []string{}).
			Default([]string{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.Int32("completeness").
			Default(0),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (Word) Edges() []ent.Edge {
	return []ent.Edge{
		// Word -> Lexeme (一对多，删除Word时Lexeme.word_id设为NULL)
		// 注：级联策略在Lexeme端的edge.From中定义
		edge.To("lexemes", Lexeme.Type),
	}
}

func (Word) Indexes() []ent.Index {
	return []ent.Index{
		// 唯一约束：同一语言下的同一 lemma 只能有一个 Word 记录
		// 因为 wid = {language}:{lemma} 是唯一的
		index.Fields("language", "lemma").Unique(),
	}
}

func (Word) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "words"},
	}
}
