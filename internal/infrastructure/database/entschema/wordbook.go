package entschema

import (
	"time"

	"github.com/eslsoft/vocnet/internal/entity"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// Wordbook holds the schema definition for vocab collections.
type Wordbook struct {
	ent.Schema
}

func (Wordbook) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.Int64("user_id").Default(0),
		field.String("source").Default(string(entity.WordbookSourceUser)),
		field.Int32("sort_order").Default(0),
		field.String("language").Default(entity.LanguageEnglish.CodeOrDefault()),
		field.String("visibility").Default(string(entity.WordbookVisibilityPublic)),
		field.String("name").NotEmpty(),
		field.String("description").Default(""),
	field.JSON("annotations", map[string]string{}).
		Default(map[string]string{}).
		SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
	field.JSON("terms", []string{}).
		Default([]string{}).
		SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
	field.String("created_by").Default(""),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (Wordbook) Edges() []ent.Edge {
	return nil
}

func (Wordbook) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id", "name").Unique(),
		index.Fields("source", "sort_order"),
		index.Fields("user_id"),
	}
}

func (Wordbook) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "wordbooks"},
	}
}
