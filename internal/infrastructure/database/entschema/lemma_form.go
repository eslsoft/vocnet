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

// LemmaForm holds the schema definition for lexeme forms table.
type LemmaForm struct {
	ent.Schema
}

func (LemmaForm) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("id"),
		field.Int64("lemma_id").
			Comment("Foreign key to lemmas table"),

		// Form text
		field.String("surface").
			NotEmpty().
			Comment("Form text preserving original case (e.g. Have, LEDs, Polish)"),
		field.String("normalized").
			NotEmpty().
			Comment("Lowercase form text for efficient case-insensitive lookup (e.g. have, leds, polish)"),

		// Form type
		field.String("form_type").
			Default("LEMMA").
			Comment("LEMMA, PAST, PLURAL, PRESENT_PARTICIPLE, etc."),
		field.Bool("is_irregular").
			Default(false).
			Comment("Whether this is an irregular form (e.g. went, children)"),

		// Phonetics
		field.JSON("phonetics", []entity.Phonetic{}).
			Default([]entity.Phonetic{}).
			Optional().
			SchemaType(map[string]string{dialect.Postgres: "jsonb"}).
			Comment("IPA and dialect information"),
		field.JSON("syllables", []string{}).
			Optional().
			Comment("Syllabification list"),

		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

func (LemmaForm) Edges() []ent.Edge {
	return []ent.Edge{
		// LemmaForm -> Lemma (多对一，Lemma删除时级联删除Form)
		edge.From("lemma", Lemma.Type).
			Ref("forms").
			Field("lemma_id").
			Required().
			Unique().
			Annotations(entsql.OnDelete(entsql.Cascade)),
	}
}

func (LemmaForm) Indexes() []ent.Index {
	return []ent.Index{
		// Query by lemma_id
		index.Fields("lemma_id"),
		// Case-insensitive lookup by normalized (primary query entry point)
		index.Fields("normalized"),
		// Unique constraint: same lemma, same text (case-sensitive), same form_type
		// This allows "Polish" (LEMMA) and "polish" (LEMMA) as different entries
		// Also allows "ran" as both PAST and PAST_PARTICIPLE
		index.Fields("lemma_id", "surface", "form_type").Unique(),
	}
}

func (LemmaForm) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "lemma_forms"},
	}
}
