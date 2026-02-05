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

type Lexeme struct {
	ent.Schema
}

func (Lexeme) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.String("external_id").
			NotEmpty().
			Unique().
			Comment("Wikidata Lexeme ID (e.g. L123456)"),

		// Core identification
		field.String("language_code").
			Default("").
			Comment("Language code: en, zh-Hans, es, etc."),
		field.String("pos").
			Default("").
			Comment("Part of speech: NOUN, VERB, ADJ, ADV, PROPN, etc."),
		field.String("entry_type").
			Default("WORD").
			Comment("WORD or PHRASE"),
		field.String("level").
			Optional().
			Comment("CEFR level: A1, A2, B1, B2, C1, C2"),
		field.JSON("frequencies", []entity.Frequency{}).
			Default([]entity.Frequency{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}).
			Comment("Frequency data"),

		// Semantics
		field.String("sense_gloss").
			Optional().
			Comment("Simple one-line gloss for quick preview"),
		field.JSON("senses", []entity.LexemeSense{}).
			Default([]entity.LexemeSense{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}).
			Comment("Detailed multi-language definitions"),

		// Relationships and categories
		field.JSON("relations", []entity.LexemeRelation{}).
			Default([]entity.LexemeRelation{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}).
			Comment("synonyms, antonyms, etc."),
		field.JSON("categories", []string{}).
			Default([]string{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}).
			Comment("Thematic categories"),

		// Metadata
		field.Int32("completeness").
			Default(0).
			Comment("Data completeness 0-100"),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (Lexeme) Edges() []ent.Edge {
	return []ent.Edge{
		// Lexeme -> Lemma (一对多，删除Lexeme时级联删除Lemma)
		edge.To("lemmas", Lemma.Type).
			Annotations(entsql.OnDelete(entsql.Cascade)),
		edge.To("concept_links", LexemeConceptLink.Type).
			Annotations(entsql.OnDelete(entsql.Cascade)),
	}
}

func (Lexeme) Indexes() []ent.Index {
	return []ent.Index{
		// Query by language
		index.Fields("language_code"),
		// Query by language + pos
		index.Fields("language_code", "pos"),
	}
}

func (Lexeme) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "lexemes"},
	}
}
