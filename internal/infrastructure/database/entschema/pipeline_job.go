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

type PipelineJob struct {
	ent.Schema
}

func (PipelineJob) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.String("status").
			NotEmpty().
			Default("PENDING").
			Comment("PENDING, RUNNING, COMPLETED, FAILED, CANCELLED"),
		field.String("name").
			NotEmpty().
			Comment("Job name (system-generated or user-specified)"),
		field.String("language").
			Default("en").
			Comment("Language code"),
		field.Int32("tier").
			Default(2).
			Comment("Priority tier: 1=Core, 2=Extended, 3=LongTail"),
		field.String("term").
			Optional().
			Comment("Term for single word jobs"),
		field.JSON("terms", []string{}).
			Optional().
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}).
			Comment("Terms list for wordbook jobs"),
		field.Int32("total_terms").
			Default(0),
		field.Int32("processed").
			Default(0),
		field.Int32("skipped").
			Default(0),
		field.Int32("failed").
			Default(0),
		field.String("error_message").
			Optional().
			Comment("Error message if job failed"),
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

func (PipelineJob) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("stages", PipelineTask.Type).
			Annotations(entsql.OnDelete(entsql.Cascade)),
		edge.To("snapshot", WordSnapshot.Type).
			Unique().
			Annotations(entsql.OnDelete(entsql.SetNull)),
	}
}

func (PipelineJob) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("status"),
		index.Fields("status", "created_at"),
	}
}

func (PipelineJob) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "pipeline_jobs"},
	}
}
