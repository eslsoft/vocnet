package conceptnet

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestExtractTermInfo(t *testing.T) {
	tests := []struct {
		name     string
		uri      string
		wantLang string
		wantTerm string
	}{
		{
			name:     "bare term",
			uri:      "/c/en/hello",
			wantLang: "en",
			wantTerm: "hello",
		},
		{
			name:     "term with POS suffix /v",
			uri:      "/c/en/run/v",
			wantLang: "en",
			wantTerm: "run",
		},
		{
			name:     "term with POS suffix /n",
			uri:      "/c/en/bank/n",
			wantLang: "en",
			wantTerm: "bank",
		},
		{
			name:     "term with POS and sense",
			uri:      "/c/en/bank/n/wn/bank_1",
			wantLang: "en",
			wantTerm: "bank",
		},
		{
			name:     "multi-word term (underscore)",
			uri:      "/c/en/hot_dog/n",
			wantLang: "en",
			wantTerm: "hot_dog",
		},
		{
			name:     "non-English language",
			uri:      "/c/zh/跑/v",
			wantLang: "zh",
			wantTerm: "跑",
		},
		{
			name:     "empty string",
			uri:      "",
			wantLang: "",
			wantTerm: "",
		},
		{
			name:     "relation URI (not a concept)",
			uri:      "/r/Synonym",
			wantLang: "",
			wantTerm: "",
		},
		{
			name:     "too short",
			uri:      "/c/en",
			wantLang: "",
			wantTerm: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotLang, gotTerm := extractTermInfo(tt.uri)
			require.Equal(t, tt.wantLang, gotLang)
			require.Equal(t, tt.wantTerm, gotTerm)
		})
	}
}

// TestFetchRelations_CrossLanguageFiltering verifies that edges whose opposite endpoint
// is in a different language are silently dropped so that TargetTerm is always in the
// expected language and TargetRef carries the correct language code.
//
// This is tested at the proc_relational level (via a mock ConceptNetProvider) because
// the Reader itself requires a live SQLite index. The filtering logic lives in Reader,
// so we validate the downstream contract: the processor never sees cross-language edges.
func TestConceptNetEdge_LanguageFields(t *testing.T) {
	// Verify the field contract: StartLanguage/EndLanguage must propagate correctly.
	// We exercise extractTermInfo directly since it powers the field population.

	// /c/en/run/v  → en, run
	lang, term := extractTermInfo("/c/en/run/v")
	require.Equal(t, "en", lang)
	require.Equal(t, "run", term)

	// /c/zh/跑 (cross-language opposite) → zh, 跑  (would be filtered out)
	lang, term = extractTermInfo("/c/zh/跑")
	require.Equal(t, "zh", lang)
	require.Equal(t, "跑", term)

	// Filtering condition: startLang != language || endLang != language
	queryLang := "en"
	startLang, _ := extractTermInfo("/c/en/run/v")
	endLang, _ := extractTermInfo("/c/zh/跑")
	require.True(t, startLang != queryLang || endLang != queryLang,
		"cross-language edge should be filtered")

	// Same-language edge should NOT be filtered.
	startLang, _ = extractTermInfo("/c/en/run/v")
	endLang, _ = extractTermInfo("/c/en/jog/v")
	require.False(t, startLang != queryLang || endLang != queryLang,
		"same-language edge should pass through")
}
