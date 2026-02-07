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

type Lemma struct {
	ent.Schema
}

func (Lemma) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.Int64("lexeme_id").
			Comment("Foreign key to lexemes table"),

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
			Comment("Whether this is the primary lemma for the lexeme"),

		field.String("wikidata_qid").
			Optional().
			Comment("Wikidata entity Q-ID (e.g. Q7553)"),

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
		// Lemma -> Lexeme (多对一，Lexeme删除时级联删除Lemma)
		edge.From("lexeme", Lexeme.Type).
			Ref("lemmas").
			Field("lexeme_id").
			Required().
			Unique().
			Annotations(entsql.OnDelete(entsql.Cascade)),

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
		// Query by lexeme_id
		index.Fields("lexeme_id"),
		// Case-insensitive lookup
		index.Fields("normalized"),
		// Unique constraint: same lexeme cannot have duplicate text
		index.Fields("lexeme_id", "surface").Unique(),
		// Query by wikidata QID
		index.Fields("wikidata_qid"),
	}
}

func (Lemma) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "lemmas"},
	}
}
