package entschema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"

	"github.com/eslsoft/vocnet/internal/entity"
)

type Lexeme struct {
	ent.Schema
}

func (Lexeme) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.Int64("lemma_id").
			Comment("Foreign key to lemmas table"),
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

		// Categories
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
		// Lexeme -> Lemma (多对一，Lemma删除时级联删除Lexeme)
		// 多个Lexeme可以属于同一个Lemma（不同词性/语义）
		// 例如: water-noun-lexeme 和 water-verb-lexeme 都属于 water-lemma
		edge.To("lemma", Lemma.Type).
			Field("lemma_id").
			Required().
			Unique().
			Annotations(entsql.OnDelete(entsql.Cascade)),

		edge.To("concept_links", LexemeConceptLink.Type).
			Annotations(entsql.OnDelete(entsql.Cascade)),

		// Lexeme -> SemanticRelation (source side, one-to-many)
		edge.To("semantic_relations", SemanticRelation.Type).
			Annotations(entsql.OnDelete(entsql.Cascade)),

		// Lexeme -> SemanticRelation (target side, one-to-many)
		edge.To("semantic_relation_targets", SemanticRelation.Type).
			Annotations(entsql.OnDelete(entsql.SetNull)),
	}
}

func (Lexeme) Indexes() []ent.Index {
	return []ent.Index{
		// Query by lemma_id
		index.Fields("lemma_id"),
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
