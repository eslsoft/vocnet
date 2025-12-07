package entschema

import (
	"time"

	"github.com/google/uuid"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// DailyStats holds the schema definition for daily learning statistics.
type DailyStats struct {
	ent.Schema
}

func (DailyStats) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.UUID("user_id", uuid.UUID{}),
		field.Int64("plan_id").Comment("FK to review_plans.id"),
		field.Time("date").Comment("Normalized to UTC midnight"),
		field.Int32("cards_reviewed").Default(0).NonNegative(),
		field.Int32("new_words").Default(0).NonNegative(),
		field.Int32("time_spent_seconds").Default(0).NonNegative(),
		field.Float32("average_score").Default(0.0).Min(0.0).Max(1.0),
		field.Int32("words_mastered").Default(0).NonNegative(),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (DailyStats) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("review_plan", ReviewPlan.Type).
			Ref("daily_stats").
			Field("plan_id").
			Unique().
			Required().
			Annotations(entsql.OnDelete(entsql.Cascade)),
	}
}

func (DailyStats) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id", "plan_id", "date").Unique(),
		index.Fields("plan_id"),
		index.Fields("user_id", "date"),
	}
}

func (DailyStats) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "daily_stats"},
	}
}
