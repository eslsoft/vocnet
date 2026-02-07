package entschema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

type DistillCache struct {
	ent.Schema
}

func (DistillCache) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.String("context_hash").
			Unique().
			NotEmpty().
			Comment("SHA256(Context + Prompt + Model)"),
		field.String("model").
			NotEmpty().
			Comment("LLM model ID"),
		field.String("prompt_summary").
			Default("").
			Comment("Summary description"),
		field.JSON("response", map[string]any{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}).
			Comment("LLM raw response"),
		field.Int32("token_count").
			Default(0).
			Comment("Token consumption"),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
	}
}

func (DistillCache) Edges() []ent.Edge {
	return nil
}

func (DistillCache) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "distill_caches"},
	}
}
