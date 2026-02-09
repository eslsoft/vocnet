package pipeline

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/eslsoft/vocnet/internal/entity"
)

func TestSnapshotProcessor_IncludesFormsAndPhoneticsBeforeScoring(t *testing.T) {
	p := NewSnapshotProcessor()

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
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "preferred above all others"},
				},
			},
		},
		Forms: []*entity.LemmaForm{
			{
				Surface:  "favourite",
				FormType: entity.LexemeFormTypeLemma,
				Phonetics: []entity.Phonetic{
					{IPA: "/ˈfeɪv(ə)rɪt/", Dialect: "en-GB"},
				},
			},
		},
		FormsByLexeme: map[string][]*entity.LemmaForm{
			"L5897": {
				{
					Surface:  "favorite",
					FormType: entity.LexemeFormTypeLemma,
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
	require.NotNil(t, res.Snapshot)
	require.NotEmpty(t, res.Snapshot.Data.Lexemes)

	lex := res.Snapshot.Data.Lexemes[0]
	require.NotEmpty(t, lex.Forms)
	require.Equal(t, "favorite", lex.Forms[0].Surface)
	require.NotEmpty(t, lex.Phonetics)
	require.Equal(t, "en-US", lex.Phonetics[0].Dialect)

	// QScore should be calculated from the fully assembled snapshot data.
	require.Greater(t, res.Snapshot.QScoreCompleteness, 0.0)
}
