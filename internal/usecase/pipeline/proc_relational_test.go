package pipeline

import (
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/require"
)

func TestWordNetPOSCandidates(t *testing.T) {
	got := wordNetPOSCandidates([]*entity.Lexeme{
		{PartOfSpeech: "verb"},
		{PartOfSpeech: "adverb"},
	})

	// First positions should prioritize observed POS from lexical stage.
	require.Equal(t, "verb", got[0])
	require.Equal(t, "adverb", got[1])
	// Fallbacks are always present to improve recall.
	require.Contains(t, got, "noun")
	require.Contains(t, got, "adjective")
}
