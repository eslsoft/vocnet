package youdaodict

import (
	"fmt"
	"log"
	"path/filepath"
	"sync"

	"github.com/eslsoft/vocnet/hack/dictinit/pkg/util"
)

type Enricher struct {
	mu             sync.Mutex
	entries        map[string]YoudaoWord
	knownForms     map[string]bool
	surfaceToExtID map[string]string
}

func NewEnricher(dictDir string) (*Enricher, error) {
	log.Printf("[youdao] loading enrichment data from %s", dictDir)

	zipFiles, err := GetZipFiles(filepath.Join(dictDir, "book"))
	if err != nil {
		return nil, fmt.Errorf("get zip files: %w", err)
	}

	entries := make(map[string]YoudaoWord)
	for _, zipPath := range zipFiles {
		words, err := LoadYoudaoZip(zipPath)
		if err != nil {
			log.Printf("[youdao] warning: failed to load %s: %v", zipPath, err)
			continue
		}
		for _, word := range words {
			term := word.HeadWord
			if term == "" {
				term = word.Content.Word.WordHead
			}
			if term != "" {
				entries[util.NormalizeKey(term)] = word
			}
		}
	}

	log.Printf("[youdao] ready: %d words loaded into memory", len(entries))
	return &Enricher{
		entries:    entries,
		knownForms: make(map[string]bool),
	}, nil
}

func (e *Enricher) RegisterKnownForms(words map[string]struct{}, idMap map[string]string) {
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
	e.surfaceToExtID = idMap
	log.Printf("[youdao] Registered %d known words and %d external IDs for enrichment", len(words), len(idMap))
}

func (e *Enricher) CollectEnrichmentWords() []YoudaoWord {
	if e == nil {
		return nil
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	var enrichmentWords []YoudaoWord
	// Use our data (knownForms) to query youdaodict
	for key := range e.knownForms {
		if word, ok := e.entries[key]; ok {
			enrichmentWords = append(enrichmentWords, word)
		}
	}

	return enrichmentWords
}
