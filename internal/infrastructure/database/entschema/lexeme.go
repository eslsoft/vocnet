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

type Lexeme struct {
	ent.Schema
}

func (Lexeme) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.String("lid").
			NotEmpty().
			Unique().
			Immutable().
			Comment("Stable business identifier: {language}:{lemma}:{pos}"),
		field.Int64("word_id").
			Optional().
			Nillable().
			Comment("Foreign key to words table, nullable for migration"),
		field.String("language").
			Default(entity.LanguageEnglish.CodeOrDefault()),
		field.String("pos").
			Default(""),
		field.String("source").
			Default(""),
		field.String("entry_type").
			Default(string(entity.LexemeEntryTypeWord)),
		field.String("lemma").
			Default(""),
		field.JSON("senses", []entity.LexemeSense{}).
			Default([]entity.LexemeSense{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.JSON("relations", []entity.LexemeRelation{}).
			Default([]entity.LexemeRelation{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (Lexeme) Edges() []ent.Edge {
	return []ent.Edge{
		// Lexeme -> LexemeForm (一对多)
		edge.To("forms", LexemeForm.Type),

		// Lexeme -> Word (多对一，无外键约束)
		edge.From("word", Word.Type).
			Ref("lexemes").
			Field("word_id").
			Unique(),
	}
}

func (Lexeme) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("language", "lemma"),
		index.Fields("word_id"),
	}
}

func (Lexeme) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "lexemes"},
	}
}
