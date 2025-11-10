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
		field.String("external_id").
			NotEmpty().
			Unique().
			Comment("Wikidata Lexeme ID (e.g. L123456)"),
		field.Int64("word_id").
			Optional().
			Nillable().
			Comment("Foreign key to words table, nullable for migration"),
		field.String("language").
			Default(entity.LanguageEnglish.CodeOrDefault()),
		field.String("pos").
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
		// Lexeme -> LexemeForm (一对多，级联删除)
		edge.To("forms", LexemeForm.Type).
			Annotations(entsql.OnDelete(entsql.Cascade)),

		// Lexeme -> Word (多对一，Word删除时设为NULL)
		edge.From("word", Word.Type).
			Ref("lexemes").
			Field("word_id").
			Unique().
			Annotations(entsql.OnDelete(entsql.SetNull)),
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
