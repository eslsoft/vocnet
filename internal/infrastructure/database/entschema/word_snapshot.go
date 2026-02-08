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
			Unique().
			Comment("Foreign key to lemmas table (one snapshot per lemma)"),
		field.String("term").
			NotEmpty().
			Comment("Redundant headword"),
		field.String("language").
			NotEmpty().
			Comment("Redundant language code"),
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
			Ref("word_snapshot").
			Field("lemma_id").
			Required().
			Unique().
			Annotations(entsql.OnDelete(entsql.Cascade)),
	}
}

func (WordSnapshot) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("term", "language"),
		index.Fields("qscore"),
	}
}

func (WordSnapshot) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "word_snapshots"},
	}
}
