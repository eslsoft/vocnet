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

// LexemeForm holds the schema definition for lexeme forms table.
type LexemeForm struct {
	ent.Schema
}

func (LexemeForm) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
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
		field.JSON("phonetics", []entity.Phonetic{}).
			Default([]entity.Phonetic{}).
			Optional().
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
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
		// 唯一约束：同一个 lexeme、同一个 form text、同一个 form type 只能出现一次
		// 这样便于同时存储相同拼写但词性不同的记录（如 "ran" 既是 Past 也是 Past Participle）
		index.Fields("lexeme_id", "text", "form_type").Unique(),
	}
}

func (LexemeForm) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "lexeme_forms"},
	}
}
