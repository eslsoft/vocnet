package entschema

import (
	"time"

	"github.com/eslsoft/vocnet/internal/entity"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
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
		field.String("term").
			NotEmpty().
			Comment("The term stored: lemma for regular forms, or the term itself for irregular forms"),
		field.Bool("case_sensitive").
			Default(false).
			Comment("Whether this word requires case-sensitive matching (e.g., polish vs Polish)"),
		field.String("language").Default(entity.LanguageEnglish.CodeOrDefault()),
		field.JSON("tags", []string{}).
			Default([]string{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.JSON("notes", []string{}).
			Default([]string{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
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
	return []ent.Edge{}
}

func (LearnedWord) Indexes() []ent.Index {
	return []ent.Index{
		// Primary business key: user_id + term + language
		index.Fields("user_id", "term", "language").Unique(),
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
