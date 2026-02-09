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

type PipelineTask struct {
	ent.Schema
}

func (PipelineTask) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.Int64("job_id").
			Comment("Foreign key to pipeline_jobs table"),
		field.Int64("lemma_id").
			Comment("Foreign key to lemmas table"),
		field.Int32("phase").
			Comment("Pipeline phase 1-5"),
		field.String("status").
			NotEmpty().
			Comment("PENDING, RUNNING, COMPLETED, FAILED, SKIPPED"),
		field.Int32("tier").
			Default(2).
			Comment("Priority tier: 1=Core, 2=Extended, 3=LongTail"),
		field.Int32("attempts").
			Default(0).
			Comment("Retry count"),
		field.String("error_message").
			Optional().
			Comment("Last error message"),
		field.Time("started_at").
			Optional().
			Nillable(),
		field.Time("completed_at").
			Optional().
			Nillable(),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (PipelineTask) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("lemma", Lemma.Type).
			Ref("pipeline_stages").
			Field("lemma_id").
			Required().
			Unique().
			Annotations(entsql.OnDelete(entsql.Cascade)),
		edge.From("job", PipelineJob.Type).
			Ref("stages").
			Field("job_id").
			Required().
			Unique().
			Annotations(entsql.OnDelete(entsql.Cascade)),
	}
}

func (PipelineTask) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("job_id", "phase").Unique(),
		index.Fields("lemma_id"),
		index.Fields("status"),
		index.Fields("status", "tier"),
	}
}

func (PipelineTask) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "pipeline_stages"},
	}
}
