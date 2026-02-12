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

type LemmaSnapshot struct {
	ent.Schema
}

func (LemmaSnapshot) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.Int64("lemma_id").
			Comment("Foreign key to lemmas table"),
		field.Int64("job_id").
			Optional().
			Nillable().
			Comment("Pipeline job that produced this snapshot"),
		field.String("surface").
			NotEmpty().
			Comment("Lemma surface form preserving original case"),
		field.String("normalized").
			NotEmpty().
			Comment("Lowercased surface for case-insensitive lookup"),
		field.JSON("lookup_terms", []string{}).
			Default([]string{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}).
			Comment("Lookup terms including surface and inflections"),
		field.String("language").
			NotEmpty().
			Comment("Language code"),
		field.Bool("is_latest").
			Default(true).
			Comment("Whether this row is the latest snapshot for the lemma"),
		field.Int32("version").
			Default(1).
			Comment("Snapshot version incremented on each synthesis"),
		field.Int32("schema_version").
			Default(1).
			Comment("Snapshot payload schema version"),
		field.JSON("payload", entity.LemmaSnapshotData{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}).
			Comment("Self-contained materialized lemma snapshot JSON payload"),
		field.Float("quality_overall").
			Default(0).
			Comment("Overall quality score in [0,100]"),
		field.Float("quality_completeness").
			Default(0).
			Comment("Completeness quality score"),
		field.Float("quality_depth").
			Default(0).
			Comment("Depth quality score"),
		field.Float("quality_density").
			Default(0).
			Comment("Density quality score"),
		field.Float("quality_validity").
			Default(0).
			Comment("Validity quality score"),
		field.Int32("lexeme_count").
			Default(0).
			Comment("Total lexeme count in payload"),
		field.Int32("sense_count").
			Default(0).
			Comment("Total sense count in payload"),
		field.Int32("form_count").
			Default(0).
			Comment("Total form count in payload"),
		field.Int32("relation_count").
			Default(0).
			Comment("Total semantic relation count in payload"),
		field.Int32("provider_count").
			Default(0).
			Comment("Distinct provider count in payload"),
		field.Time("synthesized_at").
			Comment("Last synthesis time"),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (LemmaSnapshot) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("lemma", Lemma.Type).
			Ref("lemma_snapshots").
			Field("lemma_id").
			Required().
			Unique().
			Annotations(entsql.OnDelete(entsql.Cascade)),
		edge.From("job", PipelineJob.Type).
			Ref("lemma_snapshot").
			Field("job_id").
			Unique(),
	}
}

func (LemmaSnapshot) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("lemma_id", "version").Unique(),
		index.Fields("lemma_id", "is_latest"),
		index.Fields("normalized", "language", "is_latest"),
		index.Fields("surface", "language", "is_latest"),
		index.Fields("quality_overall"),
	}
}

func (LemmaSnapshot) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "lemma_snapshots"},
	}
}
