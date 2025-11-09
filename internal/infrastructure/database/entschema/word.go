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

type Word struct {
	ent.Schema
}

func (Word) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.String("wid").
			NotEmpty().
			Unique().
			Comment("Stable business identifier: {language}:{lemma}"),
		field.String("lemma").
			NotEmpty(),
		field.String("language").
			NotEmpty(),
		field.JSON("phonetics", []entity.Phonetic{}).
			Default([]entity.Phonetic{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.JSON("categories", []string{}).
			Default([]string{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.JSON("lexeme_ids", []string{}).
			Default([]string{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.Int32("completeness").
			Default(0),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (Word) Edges() []ent.Edge {
	return []ent.Edge{
		// Word -> Lexeme (一对多，通过 word_id 字段关联)
		edge.To("lexemes", Lexeme.Type),
	}
}

func (Word) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("language", "lemma"),
	}
}

func (Word) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "words"},
	}
}
