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

	"github.com/eslsoft/vocnet/internal/entity"
)

type Lemma struct {
	ent.Schema
}

func (Lemma) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),

		// Dictionary form text
		field.String("surface").
			NotEmpty().
			Comment("Dictionary form preserving original case (e.g. Have, LED, Polish)"),
		field.String("normalized").
			NotEmpty().
			Comment("Lowercase form for case-insensitive lookup (e.g. have, led, polish)"),

		// Orthographic variant support
		field.String("variant").
			Optional().
			Comment("Orthographic variant type: US, UK, archaic, etc. (e.g. color vs colour)"),
		field.Bool("is_primary").
			Default(true).
			Comment("Whether this is the primary lemma (for variant handling)"),
		field.String("level").
			Optional().
			Comment("CEFR level: A1, A2, B1, B2, C1, C2"),
		field.JSON("frequencies", []entity.Frequency{}).
			Default([]entity.Frequency{}).
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}).
			Comment("Lemma-level frequency data"),

		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (Lemma) Edges() []ent.Edge {
	return []ent.Edge{
		// Lemma <- Lexeme (一对多反向边，Lexeme有lemma_id字段)
		// 一个Lemma可以有多个Lexemes（不同词性/语义）
		// 例如: "water" lemma -> [water-noun lexeme, water-verb lexeme]
		edge.From("lexemes", Lexeme.Type).
			Ref("lemma"),

		// Lemma -> LexemeForm (一对多，Lemma删除时级联删除Form)
		edge.To("forms", LexemeForm.Type).
			Annotations(entsql.OnDelete(entsql.Cascade)),

		// Lemma -> RawEvidence (一对多)
		edge.To("raw_evidences", RawEvidence.Type).
			Annotations(entsql.OnDelete(entsql.Cascade)),

		// Lemma -> PipelineTask (一对多)
		edge.To("pipeline_tasks", PipelineTask.Type).
			Annotations(entsql.OnDelete(entsql.Cascade)),

		// Lemma -> WordSnapshot (一对一)
		edge.To("word_snapshot", WordSnapshot.Type).
			Unique().
			Annotations(entsql.OnDelete(entsql.Cascade)),
	}
}

func (Lemma) Indexes() []ent.Index {
	return []ent.Index{
		// Case-insensitive lookup
		index.Fields("normalized"),
		// Unique constraint: one lemma per surface form (case-sensitive)
		// Note: Different spellings (color/colour) are separate lemmas
		index.Fields("surface").Unique(),
	}
}

func (Lemma) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "lemmas"},
	}
}
