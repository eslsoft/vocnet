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

// Concept holds the schema definition for ConceptNet concepts.
type Concept struct {
	ent.Schema
}

func (Concept) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.String("conceptnet_id").
			NotEmpty().
			Unique().
			Comment("ConceptNet URI, e.g. /c/en/ice_cream"),
		field.String("language_code").
			Default("").
			Comment("Language code segment in ConceptNet URI"),
		field.String("label").
			Default("").
			Comment("Human-readable label (decoded, underscores replaced)"),
		field.String("normalized").
			Default("").
			Comment("Lowercased label for lookup"),
		field.String("pos").
			Optional().
			Comment("Optional part-of-speech segment from ConceptNet URI"),
		field.String("sense").
			Optional().
			Comment("Optional sense segment from ConceptNet URI"),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (Concept) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("outgoing_edges", ConceptNetEdge.Type),
		edge.To("incoming_edges", ConceptNetEdge.Type),
		edge.To("lexeme_links", LexemeConceptLink.Type),
	}
}

func (Concept) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("language_code"),
		index.Fields("normalized"),
	}
}

func (Concept) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "concepts"},
	}
}
