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

func TestParsePOSFromSource_ECDICTWeightedFormats(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected entity.PartOfSpeech
	}{
		{"single weighted n:100", "n:100", entity.PartOfSpeechNoun},
		{"single weighted v:88", "v:88", entity.PartOfSpeechVerb},
		{"single weighted r:100", "r:100", entity.PartOfSpeechAdverb},
		{"single weighted j:98", "j:98", entity.PartOfSpeechAdjective},
		{"multi weighted v:15/n:85", "v:15/n:85", entity.PartOfSpeechNoun},
		{"multi weighted j:88/n:12", "j:88/n:12", entity.PartOfSpeechAdjective},
		{"multi weighted n:42/v:58", "n:42/v:58", entity.PartOfSpeechVerb},
		{"multi weighted r:2/j:98", "r:2/j:98", entity.PartOfSpeechAdjective},
		{"multi weighted v:35/n:65", "v:35/n:65", entity.PartOfSpeechNoun},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pos, err := parsePOSFromSource("ecdict", tt.input)
			require.NoError(t, err, "input: %s", tt.input)
			require.Equal(t, tt.expected, pos, "input: %s", tt.input)
		})
	}
}

func TestParsePOSFromSource_WikidataUnknownQIDFails(t *testing.T) {
	_, err := parsePOSFromSource("wikidata", "Q999999999")
	require.Error(t, err)
}

func TestParsePOSFromSource_WikidataAdditionalQIDMappings(t *testing.T) {
	tests := []struct {
		qid      string
		expected entity.PartOfSpeech
	}{
		{qid: "Q1964223", expected: entity.PartOfSpeechSuffix},
		{qid: "Q953129", expected: entity.PartOfSpeechPronoun},
		{qid: "Q66614499", expected: entity.PartOfSpeechSuffix},
		{qid: "Q106610283", expected: entity.PartOfSpeechSuffix},
		{qid: "Q161873", expected: entity.PartOfSpeechAdposition},
		{qid: "Q131431824", expected: entity.PartOfSpeechVerb},
		{qid: "Q5978305", expected: entity.PartOfSpeechSCONJ},
		{qid: "Q101244", expected: entity.PartOfSpeechAbbreviation},
		{qid: "Q1462657", expected: entity.PartOfSpeechPronoun},
		{qid: "Q3397768", expected: entity.PartOfSpeechAdposition},
		{qid: "Q10319522", expected: entity.PartOfSpeechAdposition},
		{qid: "Q1167104", expected: entity.PartOfSpeechSCONJ},
		{qid: "Q29888377", expected: entity.PartOfSpeechNoun},
	}

	for _, tt := range tests {
		t.Run(tt.qid, func(t *testing.T) {
			pos, err := parsePOSFromSource("wikidata", tt.qid)
			require.NoError(t, err)
			require.Equal(t, tt.expected, pos)
		})
	}
}

func TestValidateContextPOS_FailsOnInvalidValue(t *testing.T) {
	err := validateContextPOS(&PipelineContext{
		Lexemes: []*entity.Lexeme{{ExternalID: "L1", PartOfSpeech: entity.PartOfSpeech("Q134830")}},
	})
	require.Error(t, err)
}
