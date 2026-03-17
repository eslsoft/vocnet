package collection

import (
	"testing"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFilterLexemesByLemmaGroup(t *testing.T) {
	tests := []struct {
		name     string
		term     string
		lexemes  []provider.WikidataLexeme
		wantIDs  []string // expected lexeme IDs in result
		wantDrop []string // lexeme IDs that should NOT be in result
	}{
		{
			name: "others: filters out another group, keeps other group",
			term: "others",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L4334", Lemma: "other", POS: "noun"},
				{LexemeID: "L333990", Lemma: "other", POS: "pronoun"},
				{LexemeID: "L1323945", Lemma: "other", POS: "verb"},
				{LexemeID: "L1323942", Lemma: "another", POS: "Q956030"},
			},
			wantIDs:  []string{"L4334", "L333990", "L1323945"},
			wantDrop: []string{"L1323942"},
		},
		{
			name: "left: exact match kept, leave group filtered (no prefix)",
			term: "left",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L100", Lemma: "leave", POS: "verb"},
				{LexemeID: "L101", Lemma: "leave", POS: "noun"},
				{LexemeID: "L200", Lemma: "left", POS: "adjective"},
			},
			wantIDs:  []string{"L200"},
			wantDrop: []string{"L100", "L101"},
		},
		{
			name: "saw: exact match kept, see group filtered (no prefix)",
			term: "saw",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L10", Lemma: "see", POS: "verb"},
				{LexemeID: "L20", Lemma: "saw", POS: "noun"},
				{LexemeID: "L21", Lemma: "saw", POS: "verb"},
			},
			wantIDs:  []string{"L20", "L21"},
			wantDrop: []string{"L10"},
		},
		{
			name: "working: keeps both groups (work is prefix of working)",
			term: "working",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L330604", Lemma: "working", POS: "noun"},
				{LexemeID: "L342574", Lemma: "working", POS: "adjective"},
				{LexemeID: "L1291", Lemma: "work", POS: "verb"},
			},
			wantIDs: []string{"L330604", "L342574", "L1291"},
		},
		{
			name: "satisfying: keeps both groups (satisfy is prefix of satisfying)",
			term: "satisfying",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L340134", Lemma: "satisfying", POS: "adjective"},
				{LexemeID: "L6319", Lemma: "satisfy", POS: "verb"},
			},
			wantIDs: []string{"L340134", "L6319"},
		},
		{
			name: "single group: all lexemes kept",
			term: "running",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L1", Lemma: "run", POS: "verb"},
				{LexemeID: "L2", Lemma: "run", POS: "noun"},
			},
			wantIDs: []string{"L1", "L2"},
		},
		{
			name: "single lexeme: kept as-is",
			term: "hello",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L1", Lemma: "hello", POS: "noun"},
			},
			wantIDs: []string{"L1"},
		},
		{
			name: "empty input returns empty",
			term: "anything",
			lexemes: []provider.WikidataLexeme{},
			wantIDs: nil,
		},
		{
			name: "case insensitive lemma match",
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
			name: "no exact or prefix match: largest group wins",
			term: "bats",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L1", Lemma: "bat", POS: "noun"},
				{LexemeID: "L2", Lemma: "bat", POS: "verb"},
				{LexemeID: "L3", Lemma: "bate", POS: "verb"},
			},
			wantIDs:  []string{"L1", "L2"},
			wantDrop: []string{"L3"},
		},
		{
			name: "no related groups, equal size: alphabetically first lemma wins",
			term: "lies",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L1", Lemma: "lie", POS: "verb"},
				{LexemeID: "L2", Lemma: "lye", POS: "noun"},
			},
			wantIDs:  []string{"L1"},
			wantDrop: []string{"L2"},
		},
		{
			name: "exact match beats larger unrelated group",
			term: "bear",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L1", Lemma: "bare", POS: "verb"},
				{LexemeID: "L2", Lemma: "bare", POS: "adjective"},
				{LexemeID: "L3", Lemma: "bare", POS: "noun"},
				{LexemeID: "L4", Lemma: "bear", POS: "noun"},
			},
			wantIDs:  []string{"L4"},
			wantDrop: []string{"L1", "L2", "L3"},
		},
		{
			name: "prefix keeps both: unrelated group still filtered",
			term: "workings",
			lexemes: []provider.WikidataLexeme{
				{LexemeID: "L1", Lemma: "working", POS: "noun"},
				{LexemeID: "L2", Lemma: "work", POS: "verb"},
				{LexemeID: "L3", Lemma: "wok", POS: "noun"},
			},
			wantIDs:  []string{"L1", "L2"},
			wantDrop: []string{"L3"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := filterLexemesByLemmaGroup(tt.lexemes, tt.term)

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
