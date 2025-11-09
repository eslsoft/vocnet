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

// LexemeForm holds the schema definition for lexeme forms table.
type LexemeForm struct {
	ent.Schema
}

func (LexemeForm) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("lexeme_id").
			Comment("Foreign key to lexemes.id"),
		field.String("text").
			NotEmpty().
			Comment("Lowercase form text for lookup"),
		field.String("form_type").
			Default("").
			Comment("LEMMA, PAST, PLURAL, etc."),
		field.Bool("is_irregular").
			Default(false),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (LexemeForm) Edges() []ent.Edge {
	return []ent.Edge{
		// LexemeForm -> Lexeme (多对一)
		edge.From("lexeme", Lexeme.Type).
			Ref("forms").
			Field("lexeme_id").
			Required().
			Unique(),
	}
}

func (LexemeForm) Indexes() []ent.Index {
	return []ent.Index{
		// 高效查找：通过 text 查找对应的 lexeme
		index.Fields("text"),
		// 唯一约束：同一个 lexeme 不能有重复的 form text
		index.Fields("lexeme_id", "text").Unique(),
		// 复合索引：支持按 lexeme_id 快速获取所有 forms
		index.Fields("lexeme_id"),
	}
}

func (LexemeForm) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "lexeme_forms"},
	}
}
