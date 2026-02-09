package pipeline

import (
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/require"
)

func TestParsePOSFromSource_WikidataQID(t *testing.T) {
	pos, err := parsePOSFromSource("wikidata", "Q1084")
	require.NoError(t, err)
	require.Equal(t, entity.PartOfSpeechNoun, pos)
}

func TestParsePOSFromSource_ECDICTCompoundPOS(t *testing.T) {
	pos, err := parsePOSFromSource("ecdict", "n./vt.")
	require.NoError(t, err)
	require.Equal(t, entity.PartOfSpeechNoun, pos)
}

func TestParsePOSFromSource_WikidataUnknownQIDFails(t *testing.T) {
	_, err := parsePOSFromSource("wikidata", "Q999999999")
	require.Error(t, err)
}

func TestValidateContextPOS_FailsOnInvalidValue(t *testing.T) {
	err := validateContextPOS(&PipelineContext{
		Lexemes: []*entity.Lexeme{{ExternalID: "L1", PartOfSpeech: entity.PartOfSpeech("Q134830")}},
	})
	require.Error(t, err)
}
