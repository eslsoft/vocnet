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
)

type RawEvidence struct {
	ent.Schema
}

func (RawEvidence) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.Int64("lemma_id").
			Comment("Foreign key to lemmas table"),
		field.String("provider").
			NotEmpty().
			Comment("Data source: wikidata, wordnet, ecdict, conceptnet, llm, manual"),
		field.Int32("phase").
			Comment("Pipeline phase 1-5"),
		field.JSON("content", map[string]any{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}).
			Comment("Raw response envelope (complete JSON)"),
		field.String("schema_version").
			Default("").
			Comment("Provider data format version"),
		field.Time("fetched_at").
			Comment("When the source data was fetched"),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
	}
}

func (RawEvidence) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("lemma", Lemma.Type).
			Ref("raw_evidences").
			Field("lemma_id").
			Required().
			Unique().
			Annotations(entsql.OnDelete(entsql.Cascade)),
	}
}

func (RawEvidence) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("lemma_id", "provider", "phase"),
		index.Fields("provider"),
	}
}

func (RawEvidence) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "raw_evidences"},
	}
}
