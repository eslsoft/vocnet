package pipeline

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/eslsoft/vocnet/internal/entity"
)

func TestSnapshotProcessor_IncludesFormsAndPhoneticsBeforeScoring(t *testing.T) {
	p := NewLemmaSnapshotProcessor()

	pctx := &PipelineContext{
		Term:     "favourite",
		Language: entity.LanguageEnglish,
		Lemma: &entity.Lemma{
			ID:      1,
			Surface: "favourite",
		},
		Lexemes: []*entity.Lexeme{
			{
				ExternalID:   "L5897",
				PartOfSpeech: entity.PartOfSpeechAdjective,
				Categories:   []string{"domain:common", "usage:variant"},
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "preferred above all others"},
				},
			},
		},
		Forms: []*entity.LemmaForm{
			{
				Surface:  "favourite",
				FormType: entity.FormTypeLemma,
				Phonetics: []entity.Phonetic{
					{IPA: "/ˈfeɪv(ə)rɪt/", Dialect: "en-GB"},
				},
			},
		},
		FormsByLexeme: map[string][]*entity.LemmaForm{
			"L5897": {
				{
					Surface:  "favorite",
					FormType: entity.FormTypeLemma,
					Phonetics: []entity.Phonetic{
						{IPA: "/ˈfeɪv(ə)rɪt/", Dialect: "en-US"},
					},
				},
			},
		},
	}

	res, err := p.Process(context.Background(), pctx)
	require.NoError(t, err)
	require.NotNil(t, res)
	require.NotNil(t, res.LemmaSnapshot)
	require.NotEmpty(t, res.LemmaSnapshot.Payload.Lexemes)
	require.NotEmpty(t, res.LemmaSnapshot.Payload.Forms)
	require.ElementsMatch(t, []string{"domain:common", "usage:variant"}, res.LemmaSnapshot.Payload.Categories)

	lex := res.LemmaSnapshot.Payload.Lexemes[0]
	require.Equal(t, "L5897", lex.ExternalID)
	require.Equal(t, string(entity.PartOfSpeechAdjective), lex.POS)

	var found *entity.LemmaSnapshotForm
	for i := range res.LemmaSnapshot.Payload.Forms {
		if res.LemmaSnapshot.Payload.Forms[i].Surface == "favorite" {
			found = &res.LemmaSnapshot.Payload.Forms[i]
			break
		}
	}
	require.NotNil(t, found)
	require.NotEmpty(t, found.Phonetics)
	require.Equal(t, "en-US", found.Phonetics[0].Dialect)

	// Quality.Overall should be calculated from the fully assembled snapshot data.
	require.Greater(t, res.LemmaSnapshot.Quality.Completeness, 0.0)
}
