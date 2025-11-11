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

// LearnedWord holds the schema definition for the user vocabulary table.
type LearnedWord struct {
	ent.Schema
}

func (LearnedWord) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.Int64("user_id"),
		field.Int64("word_id").
			Comment("Reference to words.id"),
		field.String("display_term").
			Default("").
			Comment("The surface form user encountered (e.g. 'ran' when learning 'run')"),
		field.String("language").Default(entity.LanguageEnglish.CodeOrDefault()),
		field.JSON("tags", []string{}).
			Default([]string{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.String("note").Default(""),
		field.JSON("relations", []entity.LearnedWordRelation{}).
			Default([]entity.LearnedWordRelation{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.JSON("contexts", []entity.LearnedWordContext{}).
			Default([]entity.LearnedWordContext{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}).
			Comment("Context sentences where user encountered this word"),
		// FUTURE: Add lexeme_overrides JSONB field for per-lexeme mastery tracking
		// This will enable advanced users to track mastery for specific word senses.
		// Example structure: {"L123456": {"mastery": {...}, "note": "..."}}
		field.Int16("mastery_listen").Default(0),
		field.Int16("mastery_read").Default(0),
		field.Int16("mastery_spell").Default(0),
		field.Int16("mastery_pronounce").Default(0),
		field.Int32("mastery_overall").Default(0),
		field.Time("review_last_review_at").Optional().Nillable(),
		field.Time("review_next_review_at").Optional().Nillable(),
		field.Int32("review_interval_days").Default(0),
		field.Int32("review_fail_count").Default(0),
		field.Int64("query_count").Default(0),
		field.String("created_by").Default(""),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (LearnedWord) Edges() []ent.Edge {
	return []ent.Edge{
		// LearnedWord -> Word (多对一关系)
		edge.To("word", Word.Type).
			Field("word_id").
			Unique().
			Required().
			Annotations(entsql.OnDelete(entsql.Cascade)), // Word删除时级联删除
	}
}

func (LearnedWord) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id", "word_id").Unique(),
		index.Fields("user_id", "language", "display_term"),
		// 优化复习查询：查找需要复习的词条
		index.Fields("user_id", "review_next_review_at"),
	}
}

func (LearnedWord) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{
			Table: "learned_words",
		},
	}
}
