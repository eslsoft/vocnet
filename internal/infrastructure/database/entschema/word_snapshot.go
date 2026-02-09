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

type WordSnapshot struct {
	ent.Schema
}

func (WordSnapshot) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.Int64("lemma_id").
			Comment("Foreign key to lemmas table"),
		field.Int64("job_id").
			Optional().
			Nillable().
			Comment("Pipeline job that produced this snapshot"),
		field.String("term").
			NotEmpty().
			Comment("Redundant headword for display"),
		field.JSON("terms", []string{}).
			Default([]string{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}).
			Comment("Lookup terms (headword + normalized forms)"),
		field.String("language").
			NotEmpty().
			Comment("Redundant language code"),
		field.Bool("latest").
			Default(true).
			Comment("Whether this row is the latest snapshot version for the lemma"),
		field.Int32("version").
			Default(1).
			Comment("Snapshot version (incremented on each synthesis)"),
		field.JSON("data", entity.SnapshotData{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}).
			Comment("Self-contained materialized snapshot JSON"),
		field.Float("qscore").
			Default(0).
			Comment("Overall quality score 0-100"),
		field.Float("qscore_completeness").
			Default(0).
			Comment("Completeness dimension"),
		field.Float("qscore_depth").
			Default(0).
			Comment("Depth dimension"),
		field.Float("qscore_density").
			Default(0).
			Comment("Density dimension"),
		field.Float("qscore_validity").
			Default(0).
			Comment("Validity dimension"),
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

func (WordSnapshot) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("lemma", Lemma.Type).
			Ref("word_snapshots").
			Field("lemma_id").
			Required().
			Unique().
			Annotations(entsql.OnDelete(entsql.Cascade)),
		edge.From("job", PipelineJob.Type).
			Ref("snapshot").
			Field("job_id").
			Unique(),
	}
}

func (WordSnapshot) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("lemma_id", "version").Unique(),
		index.Fields("lemma_id", "latest"),
		index.Fields("term", "language", "latest"),
		index.Fields("qscore"),
	}
}

func (WordSnapshot) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "word_snapshots"},
	}
}
