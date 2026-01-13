package ecdict

import (
	"log"
	"sync"

	"github.com/eslsoft/vocnet/hack/dictinit/pkg/util"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

type Enricher struct {
	mu         sync.Mutex
	entries    map[string]*ecdictEnrichment
	knownForms map[string]bool // Track all forms from Wikidata (lemmas + inflected forms)
}

type ecdictEnrichment struct {
	phonetics   []*dictv1.Phonetic
	categories  []string
	domains     []string // domain markers like [计], [法], [医]
	senses      []sensePayload
	translation string // Chinese translation for reporting
	exchange    string // Word forms (e.g., "p:ran/d:ran/i:running/3:runs") for reporting
	bnc         int64  // British National Corpus frequency rank
	frq         int64  // Contemporary Corpus frequency rank
	collins     int    // Collins star rating (1-5)
	oxford      bool   // Oxford 3000 core vocabulary
}

type sensePayload struct {
	language     commonv1.Language
	partOfSpeech string
	gloss        string
}

func NewEnricher(url, cacheDir string, noCache bool) (*Enricher, error) {
	log.Printf("[ecdict] loading enrichment data (url=%s)", url)
	entries, total, err := loadECDICTEntries(url, cacheDir, noCache)
	if err != nil {
		return nil, err
	}
	log.Printf("[ecdict] ready: %d rows scanned, %d contain enrichment payloads", total, len(entries))
	return &Enricher{
		entries:    entries,
		knownForms: make(map[string]bool),
	}, nil
}

type skippedWordEntry struct {
	word        string
	reason      string
	translation string
	exchange    string
}

// CollectEnrichmentWords returns entries that already exist in the database and can be enriched.
func (e *Enricher) CollectEnrichmentWords() ([]ecdictWord, []skippedWordEntry) {
	if e == nil {
		return nil, nil
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	var enrichmentWords []ecdictWord
	var skipped []skippedWordEntry

	for word, enrichment := range e.entries {
		// Check if word has any useful data
		hasUsefulData := len(enrichment.phonetics) > 0 || len(enrichment.senses) > 0

		// Skip if no useful data at all
		if !hasUsefulData {
			skipped = append(skipped, skippedWordEntry{
				word:        word,
				reason:      "no_useful_data",
				translation: enrichment.translation,
				exchange:    enrichment.exchange,
			})
			continue
		}

		key := util.NormalizeKey(word)
		if e.knownForms[key] {
			enrichmentWords = append(enrichmentWords, ecdictWord{
				word:       word,
				enrichment: enrichment,
			})
			continue
		}

		skipped = append(skipped, skippedWordEntry{
			word:        word,
			reason:      "not_in_db",
			translation: enrichment.translation,
			exchange:    enrichment.exchange,
		})
	}

	return enrichmentWords, skipped
}

// RegisterKnownForms marks words as existing in the database (from Wikidata or previous imports).
// This allows enrichment of words without exchange data.
func (e *Enricher) RegisterKnownForms(words map[string]struct{}) {
	if e == nil {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()

	for word := range words {
		key := util.NormalizeKey(word)
		if key != "" {
			e.knownForms[key] = true
		}
	}
	log.Printf("[ecdict] Registered %d known words for enrichment", len(words))
}
