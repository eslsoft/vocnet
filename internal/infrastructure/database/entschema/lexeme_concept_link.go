package entschema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// LexemeConceptLink holds the schema definition for lexeme-to-concept links.
type LexemeConceptLink struct {
	ent.Schema
}

func (LexemeConceptLink) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.Int64("lexeme_id").Comment("Foreign key to lexemes table"),
		field.Int64("concept_id").Comment("Foreign key to concepts table"),
		field.String("match_type").
			NotEmpty().
			Default("lemma_normalized").
			Comment("How this link was matched"),
		field.Float("confidence").
			Min(0).
			Max(1).
			Default(1.0).
			Comment("Match confidence 0-1"),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (LexemeConceptLink) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("lexeme", Lexeme.Type).
			Ref("concept_links").
			Field("lexeme_id").
			Required().
			Unique(),
		edge.From("concept", Concept.Type).
			Ref("lexeme_links").
			Field("concept_id").
			Required().
			Unique(),
	}
}

func (LexemeConceptLink) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("lexeme_id"),
		index.Fields("concept_id"),
		index.Fields("lexeme_id", "concept_id").Unique(),
	}
}

func (LexemeConceptLink) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "lexeme_concept_links"},
	}
}
