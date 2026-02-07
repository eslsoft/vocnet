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

type SemanticRelation struct {
	ent.Schema
}

func (SemanticRelation) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.Int64("source_lexeme_id").
			Comment("Foreign key to source lexeme"),
		field.Int64("target_lexeme_id").
			Optional().
			Nillable().
			Comment("Foreign key to target lexeme (null = unresolved)"),
		field.String("target_term").
			NotEmpty().
			Comment("Target word display text (always set)"),
		field.String("relation_type").
			NotEmpty().
			Comment("SYNONYM, ANTONYM, HYPERNYM, HYPONYM, ASSOCIATION, CAUSE_EFFECT, PART_WHOLE, DERIVATIVE"),
		field.String("provider").
			NotEmpty().
			Comment("Source: wordnet, conceptnet, ecdict, llm, manual"),
		field.Float("strength").
			Default(0.5).
			Comment("Relation strength 0.0-1.0"),
		field.Bool("sense_mapped").
			Default(false).
			Comment("Whether sense-level disambiguation has been done"),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (SemanticRelation) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("source_lexeme", Lexeme.Type).
			Ref("semantic_relations").
			Field("source_lexeme_id").
			Required().
			Unique().
			Annotations(entsql.OnDelete(entsql.Cascade)),
		edge.From("target_lexeme", Lexeme.Type).
			Ref("semantic_relation_targets").
			Field("target_lexeme_id").
			Unique(),
	}
}

func (SemanticRelation) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("source_lexeme_id", "target_lexeme_id", "relation_type").Unique(),
		index.Fields("source_lexeme_id"),
		index.Fields("target_lexeme_id"),
		index.Fields("relation_type"),
	}
}

func (SemanticRelation) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "semantic_relations"},
	}
}
