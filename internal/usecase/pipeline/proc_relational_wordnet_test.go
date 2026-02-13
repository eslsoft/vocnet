package pipeline

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/eslsoft/vocnet/internal/adapter/provider/wordnet"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/require"
)

// buildWordNetReader creates a wordnet.Reader backed by a temporary directory
// containing minimal data.noun and data.verb files synthesized from the provided lines.
// Lines starting with two spaces are treated as comments (header) by the reader.
func buildWordNetReader(t *testing.T, dataLines map[string][]string) *wordnet.Reader {
	t.Helper()
	dir := t.TempDir()
	for filename, lines := range dataLines {
		content := "  WordNet license header\n"
		for _, l := range lines {
			content += l + "\n"
		}
		require.NoError(t, os.WriteFile(filepath.Join(dir, filename), []byte(content), 0o600))
	}
	return wordnet.NewReader(dir)
}

// WordNet data.noun line format:
// synset_offset lex_filenum ss_type w_cnt word lex_id [...] p_cnt [ptr...] | gloss
//
// Minimal example:
//   00001740 03 n 01 entity 0 000 | root entity
//   00002000 03 n 01 object 0 001 @ 00001740 n 0000 | a tangible thing (hypernym→entity)
//   00003000 03 n 01 chair 0 002 @ 00002000 n 0000 ! 00004000 n 0000 | a seat with a back (hypernym→object, antonym→something)
//   00004000 03 n 01 something 0 000 | a placeholder antonym target

// TestWordNetHypernyms_TargetTermIsWord verifies that TargetTerm in hypernym relations
// contains the plain word from the parent synset, not a "synset:offset (word)" string.
func TestWordNetHypernyms_TargetTermIsWord(t *testing.T) {
	reader := buildWordNetReader(t, map[string][]string{
		"data.noun": {
			// entity – root, no hypernym
			"00001740 03 n 01 entity 0 000 | root concept",
			// object → entity
			"00002000 03 n 01 object 0 001 @ 00001740 n 0000 | a tangible thing",
			// chair → object
			"00003000 03 n 01 chair 0 001 @ 00002000 n 0000 | a seat with a back",
		},
	})

	p := NewWordNetProcessor(reader)
	pctx := &PipelineContext{
		Term:     "chair",
		Language: entity.LanguageEnglish,
		Lexemes:  []*entity.Lexeme{{ExternalID: "L1", PartOfSpeech: entity.PartOfSpeechNoun}},
	}

	res, err := p.Process(context.Background(), pctx)
	require.NoError(t, err)
	require.NotNil(t, res)

	// Collect hypernym relations only.
	var hypernyms []*entity.SemanticRelation
	for _, r := range res.Relations {
		if r.RelationType == entity.RelationHypernym {
			hypernyms = append(hypernyms, r)
		}
	}
	require.NotEmpty(t, hypernyms, "expected hypernym relations")

	for _, r := range hypernyms {
		// TargetTerm must be a plain word, never contain "synset:" prefix.
		require.NotContains(t, r.TargetTerm, "synset:", "TargetTerm should be a plain word, got: %q", r.TargetTerm)
		// TargetRef must carry the stable URI.
		require.Contains(t, r.TargetRef, "wordnet://synset/", "TargetRef should be a URI, got: %q", r.TargetRef)
	}

	// Verify specific terms: chair → object → entity.
	terms := make(map[string]string) // TargetRef → TargetTerm
	for _, r := range hypernyms {
		terms[r.TargetRef] = r.TargetTerm
	}
	require.Equal(t, "object", terms["wordnet://synset/00002000"])
	require.Equal(t, "entity", terms["wordnet://synset/00001740"])
}

// TestWordNetHypernyms_FallbackToOffsetWhenNoWords verifies that when a parent synset
// has no words (malformed data), TargetTerm falls back to the offset string (not "synset:offset").
func TestWordNetHypernyms_FallbackToOffsetWhenNoWords(t *testing.T) {
	reader := buildWordNetReader(t, map[string][]string{
		"data.noun": {
			// Parent synset with zero words.
			"00001740 03 n 00 0 000 | wordless root",
			// Child points to the wordless parent.
			"00002000 03 n 01 thing 0 001 @ 00001740 n 0000 | a thing",
		},
	})

	p := NewWordNetProcessor(reader)
	pctx := &PipelineContext{
		Term:     "thing",
		Language: entity.LanguageEnglish,
		Lexemes:  []*entity.Lexeme{{ExternalID: "L1", PartOfSpeech: entity.PartOfSpeechNoun}},
	}

	res, err := p.Process(context.Background(), pctx)
	require.NoError(t, err)

	var hypernyms []*entity.SemanticRelation
	for _, r := range res.Relations {
		if r.RelationType == entity.RelationHypernym {
			hypernyms = append(hypernyms, r)
		}
	}
	require.Len(t, hypernyms, 1)

	r := hypernyms[0]
	// Should fall back to the offset, but still not include "synset:" prefix.
	require.NotContains(t, r.TargetTerm, "synset:")
	require.Equal(t, "00001740", r.TargetTerm)
	require.Equal(t, "wordnet://synset/00001740", r.TargetRef)
}

// TestWordNetOtherRelations_TargetTermIsWord verifies that non-hypernym relations
// (e.g., antonyms) resolve the target synset and store the plain word in TargetTerm.
func TestWordNetOtherRelations_TargetTermIsWord(t *testing.T) {
	reader := buildWordNetReader(t, map[string][]string{
		"data.noun": {
			// "day" has an antonym pointing to "night" (offset 00002000).
			"00001000 03 n 01 day 0 001 ! 00002000 n 0000 | period of daylight",
			// "night" synset.
			"00002000 03 n 01 night 0 000 | period of darkness",
		},
	})

	p := NewWordNetProcessor(reader)
	pctx := &PipelineContext{
		Term:     "day",
		Language: entity.LanguageEnglish,
		Lexemes:  []*entity.Lexeme{{ExternalID: "L1", PartOfSpeech: entity.PartOfSpeechNoun}},
	}

	res, err := p.Process(context.Background(), pctx)
	require.NoError(t, err)
	require.NotNil(t, res)

	var antonyms []*entity.SemanticRelation
	for _, r := range res.Relations {
		if r.RelationType == entity.RelationAntonym {
			antonyms = append(antonyms, r)
		}
	}
	require.Len(t, antonyms, 1)

	r := antonyms[0]
	// TargetTerm must be the word "night", not "synset:00002000".
	require.Equal(t, "night", r.TargetTerm)
	require.Equal(t, "wordnet://synset/00002000", r.TargetRef)
	require.NotContains(t, r.TargetTerm, "synset:")
}

// TestWordNetOtherRelations_FallbackToOffsetWhenSynsetMissing verifies that when the
// target synset cannot be found (e.g., cross-POS reference not loaded), TargetTerm
// falls back to the raw offset ID rather than containing "synset:ID".
func TestWordNetOtherRelations_FallbackToOffsetWhenSynsetMissing(t *testing.T) {
	reader := buildWordNetReader(t, map[string][]string{
		"data.noun": {
			// Antonym target offset 00009999 does not exist in any loaded file.
			"00001000 03 n 01 good 0 001 ! 00009999 n 0000 | morally excellent",
		},
	})

	p := NewWordNetProcessor(reader)
	pctx := &PipelineContext{
		Term:     "good",
		Language: entity.LanguageEnglish,
		Lexemes:  []*entity.Lexeme{{ExternalID: "L1", PartOfSpeech: entity.PartOfSpeechNoun}},
	}

	res, err := p.Process(context.Background(), pctx)
	require.NoError(t, err)

	var antonyms []*entity.SemanticRelation
	for _, r := range res.Relations {
		if r.RelationType == entity.RelationAntonym {
			antonyms = append(antonyms, r)
		}
	}
	require.Len(t, antonyms, 1)

	r := antonyms[0]
	// Must NOT contain "synset:" prefix even in the fallback case.
	require.NotContains(t, r.TargetTerm, "synset:")
	require.Equal(t, "00009999", r.TargetTerm)
	require.Equal(t, "wordnet://synset/00009999", r.TargetRef)
}
