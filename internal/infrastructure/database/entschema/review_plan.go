package entschema

import (
	"time"

	"github.com/google/uuid"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// ReviewPlan holds the schema definition for user vocabulary review plans.
type ReviewPlan struct {
	ent.Schema
}

func (ReviewPlan) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.UUID("user_id", uuid.UUID{}),
		field.String("name").NotEmpty(),
		field.String("description").Default(""),
		field.Int32("daily_new_limit").Default(20),
		field.JSON("wordbook_ids", []int64{}).
			Default([]int64{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (ReviewPlan) Edges() []ent.Edge {
	return nil
}

func (ReviewPlan) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id", "name").Unique(),
		index.Fields("user_id"),
	}
}

func (ReviewPlan) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "review_plans"},
	}
}
