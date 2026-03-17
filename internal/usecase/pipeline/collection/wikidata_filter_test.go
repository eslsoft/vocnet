package collection

import (
	"testing"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFilterLexemesByLemma(t *testing.T) {
	tests := []struct {
		name     string
		term     string
		lexemes  []provider.WikidataLexeme
		wantIDs  []string
		wantDrop []string
	}{
		{
			name: "exact match only: played keeps played, drops play",
			term: "played",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L100", Lemma: "played", POS: "adjective"},
				{LexemeID: "L1292", Lemma: "play", POS: "verb"},
			},
			wantIDs:  []string{"L100"},
			wantDrop: []string{"L1292"},
		},
		{
			name: "exact match only: play keeps play, drops played",
			term: "play",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L1292", Lemma: "play", POS: "verb"},
				{LexemeID: "L1293", Lemma: "play", POS: "noun"},
				{LexemeID: "L100", Lemma: "played", POS: "adjective"},
			},
			wantIDs:  []string{"L1292", "L1293"},
			wantDrop: []string{"L100"},
		},
		{
			name: "satisfying keeps only satisfying lexemes",
			term: "satisfying",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L340134", Lemma: "satisfying", POS: "adjective"},
				{LexemeID: "L6319", Lemma: "satisfy", POS: "verb"},
			},
			wantIDs:  []string{"L340134"},
			wantDrop: []string{"L6319"},
		},
		{
			name: "satisfy keeps only satisfy lexemes",
			term: "satisfy",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L340134", Lemma: "satisfying", POS: "adjective"},
				{LexemeID: "L6319", Lemma: "satisfy", POS: "verb"},
			},
			wantIDs:  []string{"L6319"},
			wantDrop: []string{"L340134"},
		},
		{
			name: "case insensitive match",
			term: "Bank",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L1", Lemma: "bank", POS: "noun"},
				{LexemeID: "L2", Lemma: "Bank", POS: "noun"},
				{LexemeID: "L3", Lemma: "bench", POS: "noun"},
			},
			wantIDs:  []string{"L1", "L2"},
			wantDrop: []string{"L3"},
		},
		{
			name: "multiple POS same lemma: all kept",
			term: "run",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L1", Lemma: "run", POS: "verb"},
				{LexemeID: "L2", Lemma: "run", POS: "noun"},
			},
			wantIDs: []string{"L1", "L2"},
		},
		{
			name: "single lexeme exact match",
			term: "hello",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L1", Lemma: "hello", POS: "noun"},
			},
			wantIDs: []string{"L1"},
		},
		{
			name: "no match returns empty",
			term: "xyz",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L1", Lemma: "abc", POS: "noun"},
			},
			wantIDs: nil,
		},
		{
			name: "empty input returns empty",
			term: "anything",
			lexemes: []provider.WikidataLexeme{},
			wantIDs: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := filterLexemesByLemma(tt.lexemes, tt.term)

			gotIDs := make([]string, len(result))
			for i, lex := range result {
				gotIDs[i] = lex.LexemeID
			}

			if tt.wantIDs == nil {
				require.Empty(t, result)
				return
			}

			require.Len(t, result, len(tt.wantIDs), "unexpected number of lexemes")
			for _, wantID := range tt.wantIDs {
				assert.Contains(t, gotIDs, wantID, "expected lexeme %s in result", wantID)
			}
			for _, dropID := range tt.wantDrop {
				assert.NotContains(t, gotIDs, dropID, "lexeme %s should have been filtered out", dropID)
			}
		})
	}
}
