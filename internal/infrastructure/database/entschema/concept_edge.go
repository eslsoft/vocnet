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

// ConceptNetEdge holds the schema definition for ConceptNet edges.
type ConceptNetEdge struct {
	ent.Schema
}

func (ConceptNetEdge) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.Int64("source_id").Comment("Source concept ID"),
		field.Int64("target_id").Comment("Target concept ID"),
		field.String("relation").
			NotEmpty().
			Default("").
			Comment("Relation label, e.g. IsA, UsedFor"),
		field.Float("weight").
			Min(0).
			Default(0).
			Comment("ConceptNet edge weight"),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (ConceptNetEdge) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("source", Concept.Type).
			Ref("outgoing_edges").
			Field("source_id").
			Required().
			Unique(),
		edge.From("target", Concept.Type).
			Ref("incoming_edges").
			Field("target_id").
			Required().
			Unique(),
	}
}

func (ConceptNetEdge) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("source_id"),
		index.Fields("target_id"),
		index.Fields("relation"),
		index.Fields("relation", "source_id", "target_id").Unique(),
	}
}

func (ConceptNetEdge) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "concept_edges"},
	}
}
