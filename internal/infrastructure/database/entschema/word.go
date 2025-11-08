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

// Word holds the schema definition for the words table.
type Word struct {
	ent.Schema
}

// Edges of the Word.
func (Word) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("learned_lexemes", LearnedLexeme.Type),
	}
}

// Fields of the Word.
func (Word) Fields() []ent.Field {
	return []ent.Field{
		field.String("text").NotEmpty(),
		field.String("normalized").Default(""),
		field.String("language").Default("en"),
		field.String("word_type").Default("lemma"),
		field.String("lemma").Optional().Nillable(),
		field.JSON("phonetics", []entity.WordPhonetic{}).
			Default([]entity.WordPhonetic{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.JSON("definitions", []entity.WordDefinition{}).
			Default([]entity.WordDefinition{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.JSON("phrases", []entity.Phrase{}).
			Default([]entity.Phrase{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.JSON("sentences", []entity.Sentence{}).
			Default([]entity.Sentence{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.JSON("relations", []entity.WordRelation{}).
			Default([]entity.WordRelation{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.JSON("categories", []string{}).
			Default([]string{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.Int32("completeness").
			Default(0),
		field.Bool("is_standard_rule").
			Default(false),
		field.Bool("is_manual_edited").
			Default(false),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

// Indexes of the Word.
func (Word) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("language", "text").Unique(),
		index.Fields("language", "normalized"),
	}
}

// Annotations of the Word.
func (Word) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{
			Table: "words",
			Checks: map[string]string{
				"chk_words_lemma_ref": "((word_type = 'lemma' AND lemma IS NULL) OR (word_type <> 'lemma' AND lemma IS NOT NULL))",
			},
		},
	}
}
