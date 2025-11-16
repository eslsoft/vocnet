package usecase

import (
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/require"
)

func TestMergeFormLists(t *testing.T) {
	t.Run("updates existing form data", func(t *testing.T) {
		existing := []entity.LexemeForm{
			{
				Text:      "run",
				FormType:  entity.LexemeFormTypeLemma,
				Phonetics: []entity.Phonetic{{IPA: "/rʌn/", Dialect: "en-US"}},
			},
		}
		incoming := []entity.LexemeForm{
			{
				Text:     "run",
				FormType: entity.LexemeFormTypeLemma,
				Phonetics: []entity.Phonetic{
					{IPA: "/rʌn/", Dialect: "en-US"},
					{IPA: "/rʌn/", Dialect: "en-GB"},
				},
			},
		}

		merged := mergeFormLists(existing, incoming)
		require.Len(t, merged, 1)
		require.Len(t, merged[0].Phonetics, 2)
		require.Equal(t, "en-GB", merged[0].Phonetics[1].Dialect)
	})

	t.Run("preserves existing when incoming empty", func(t *testing.T) {
		existing := []entity.LexemeForm{
			{Text: "run", FormType: entity.LexemeFormTypeLemma},
			{Text: "ran", FormType: entity.LexemeFormTypePast},
		}

		merged := mergeFormLists(existing, nil)
		require.Len(t, merged, 2)
		require.Equal(t, "run", merged[0].Text)
		require.Equal(t, "ran", merged[1].Text)
	})

	t.Run("appends brand new forms", func(t *testing.T) {
		existing := []entity.LexemeForm{
			{Text: "run", FormType: entity.LexemeFormTypeLemma},
		}
		incoming := []entity.LexemeForm{
			{Text: "running", FormType: entity.LexemeFormTypePresentParticiple},
		}

		merged := mergeFormLists(existing, incoming)
		require.Len(t, merged, 2)
		require.Equal(t, entity.LexemeFormTypePresentParticiple, merged[1].FormType)
		require.Equal(t, "running", merged[1].Text)
	})
}
