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

// LearnedLexeme holds the schema definition for the user lexemes table.
type LearnedLexeme struct {
	ent.Schema
}

func (LearnedLexeme) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.Int64("user_id"),
		field.Int64("lexeme_id").
			Optional().
			Nillable().
			Comment("Current association to lexemes.id, nullable for migration"),
		field.String("lexeme_external_id").
			NotEmpty().
			Comment("Wikidata Lexeme ID (e.g. L123456)"),
		field.String("display_term").Default(""),
		field.String("language").Default(entity.LanguageEnglish.CodeOrDefault()),
		field.JSON("tags", []string{}).
			Default([]string{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.String("note").Default(""),
		field.JSON("relations", []entity.LearnedLexemeRelation{}).
			Default([]entity.LearnedLexemeRelation{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.JSON("form_status", map[string]entity.FormMastery{}).
			Default(map[string]entity.FormMastery{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
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

func (LearnedLexeme) Edges() []ent.Edge {
	return []ent.Edge{
		// LearnedLexeme -> Lexeme (多对一，可选关系)
		edge.To("lexeme", Lexeme.Type).
			Field("lexeme_id").
			Unique().
			Annotations(entsql.OnDelete(entsql.SetNull)), // Lexeme删除时设为NULL
	}
}

func (LearnedLexeme) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id", "lexeme_external_id").Unique(),
		index.Fields("user_id", "language", "display_term"),
		index.Fields("lexeme_id"),
		// 优化复习查询：查找需要复习的词条
		index.Fields("user_id", "review_next_review_at"),
	}
}

func (LearnedLexeme) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{
			Table: "learned_lexemes",
		},
	}
}
