package wordnet

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/eslsoft/vocnet/internal/entity"
)

// Reader reads WordNet data files to extract synsets and relations.
// All data files are loaded into memory at initialization for fast lookups.
// The reader is safe for concurrent use after creation.
type Reader struct {
	dataDir string
	// wordIndex maps lowercase word -> []*Synset for each POS file
	wordIndex map[string][]*Synset
	// offsetIndex maps "pos:offset" -> *Synset for direct synset lookups
	offsetIndex map[string]*Synset
	once        sync.Once
	loadErr     error
}

// NewReader creates a WordNet reader for the given data directory.
func NewReader(dataDir string) *Reader {
	return &Reader{
		dataDir:     dataDir,
		wordIndex:   make(map[string][]*Synset),
		offsetIndex: make(map[string]*Synset),
	}
}

// Synset represents a WordNet synset (synonym set).
type Synset struct {
	Offset      string
	POS         string // n (noun), v (verb), a (adjective), r (adverb)
	Words       []string
	Gloss       string
	Relations   []Relation
	HypernymIDs []string // @ symbol - hypernym (is-a) relations
}

// Relation represents a semantic relation in WordNet.
type Relation struct {
	Symbol     string // @ (hypernym), ~ (hyponym), = (attribute), etc.
	TargetID   string
	TargetPOS  string
	SourceWord string // word number if lexical relation
	TargetWord string
}

// ensureLoaded loads all WordNet data files into memory on first access.
// Uses sync.Once for concurrency safety.
func (r *Reader) ensureLoaded() error {
	r.once.Do(func() {
		for _, filename := range []string{"data.noun", "data.verb", "data.adj", "data.adv"} {
			if err := r.loadDataFile(filename); err != nil {
				if errors.Is(err, os.ErrNotExist) {
					continue
				}
				r.loadErr = fmt.Errorf("load %s: %w", filename, err)
				return
			}
		}
	})
	return r.loadErr
}

// loadDataFile parses a single WordNet data file and indexes its synsets.
func (r *Reader) loadDataFile(filename string) error {
	filePath := filepath.Join(r.dataDir, filename)
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, " ") || line == "" {
			continue // Skip license header
		}

		synset, err := parseSynsetLine(line)
		if err != nil {
			continue
		}

		// Index by offset+POS for direct lookups
		key := synset.POS + ":" + synset.Offset
		r.offsetIndex[key] = synset

		// Index by each word in the synset
		for _, w := range synset.Words {
			wordKey := strings.ToLower(strings.ReplaceAll(w, " ", "_"))
			r.wordIndex[wordKey] = append(r.wordIndex[wordKey], synset)
		}
	}

	return scanner.Err()
}

// LookupSynsets finds all synsets for a given word.
func (r *Reader) LookupSynsets(ctx context.Context, word string, pos string) ([]*Synset, error) {
	if err := r.ensureLoaded(); err != nil {
		return nil, err
	}

	normalizedWord := strings.ToLower(strings.ReplaceAll(word, " ", "_"))
	candidates := r.wordIndex[normalizedWord]
	if len(candidates) == 0 {
		return nil, nil
	}

	// Filter by POS if specified
	posFilter := normalizePOS(pos)

	// Separate exact case matches from case-insensitive.
	// synset.Words stores words with spaces (underscores converted to spaces),
	// so normalize the input word the same way for exact comparison.
	wordWithSpaces := strings.ReplaceAll(word, "_", " ")
	exactMatches := make([]*Synset, 0)
	caseInsensitiveMatches := make([]*Synset, 0)

	for _, synset := range candidates {
		if posFilter != "" && synset.POS != posFilter {
			continue
		}

		if slices.Contains(synset.Words, wordWithSpaces) {
			exactMatches = append(exactMatches, synset)
		} else {
			caseInsensitiveMatches = append(caseInsensitiveMatches, synset)
		}
	}

	result := make([]*Synset, 0, len(exactMatches)+len(caseInsensitiveMatches))
	result = append(result, exactMatches...)
	result = append(result, caseInsensitiveMatches...)
	return result, nil
}

// GetHypernymPath retrieves the hypernym hierarchy path for a synset.
// This is used to calculate semantic depth.
func (r *Reader) GetHypernymPath(ctx context.Context, synset *Synset) ([]*Synset, error) {
	if err := r.ensureLoaded(); err != nil {
		return nil, err
	}

	path := []*Synset{synset}
	visited := make(map[string]bool)
	visited[synset.Offset] = true

	current := synset
	for len(current.HypernymIDs) > 0 {
		// Follow the first hypernym (primary parent)
		hypernymID := current.HypernymIDs[0]
		if visited[hypernymID] {
			break // Avoid cycles
		}

		// Look up hypernym from in-memory index
		key := current.POS + ":" + hypernymID
		hypernym, ok := r.offsetIndex[key]
		if !ok {
			break
		}

		path = append(path, hypernym)
		visited[hypernymID] = true
		current = hypernym
	}

	return path, nil
}

// normalizePOS converts POS string variants to single-letter WordNet codes.
func normalizePOS(pos string) string {
	switch pos {
	case "n", "noun":
		return "n"
	case "v", "verb":
		return "v"
	case "a", "adj", "adjective":
		return "a"
	case "r", "adv", "adverb":
		return "r"
	default:
		return "" // no filter
	}
}

// parseSynsetLine parses a WordNet data file line into a Synset struct.
// Format: synset_offset lex_filenum ss_type w_cnt word lex_id [word lex_id...] p_cnt [ptr...] [frames...] | gloss
func parseSynsetLine(line string) (*Synset, error) {
	// Split at | to separate data from gloss
	parts := strings.SplitN(line, " | ", 2)
	data := strings.TrimSpace(parts[0])
	gloss := ""
	if len(parts) > 1 {
		gloss = strings.TrimSpace(parts[1])
	}

	fields := strings.Fields(data)
	if len(fields) < 6 {
		return nil, fmt.Errorf("invalid synset line: too few fields")
	}

	synset := &Synset{
		Offset:      fields[0],
		POS:         fields[2],
		Gloss:       gloss,
		Relations:   make([]Relation, 0),
		HypernymIDs: make([]string, 0),
	}

	// Parse word count
	wCnt, err := strconv.ParseInt(fields[3], 16, 64)
	if err != nil {
		return nil, fmt.Errorf("parse word count: %w", err)
	}

	// Parse words (each word has 2 fields: word and lex_id)
	idx := 4
	synset.Words = make([]string, 0, wCnt)
	for i := int64(0); i < wCnt && idx+1 < len(fields); i++ {
		word := strings.ReplaceAll(fields[idx], "_", " ")
		synset.Words = append(synset.Words, word)
		idx += 2 // Skip word and lex_id
	}

	if idx >= len(fields) {
		return synset, nil
	}

	// Parse pointer count
	pCnt, err := strconv.Atoi(fields[idx])
	if err != nil {
		return synset, nil // No relations
	}
	idx++

	// Parse relations (each relation has 4 fields: pointer_symbol synset_offset pos source/target)
	for i := 0; i < pCnt && idx+3 <= len(fields); i++ {
		rel := Relation{
			Symbol:    fields[idx],
			TargetID:  fields[idx+1],
			TargetPOS: fields[idx+2],
		}

		// Parse source/target word numbers (hex encoded, 0000 means relation applies to all words)
		sourceTarget := fields[idx+3]
		if len(sourceTarget) == 4 {
			rel.SourceWord = sourceTarget[:2]
			rel.TargetWord = sourceTarget[2:]
		}

		synset.Relations = append(synset.Relations, rel)

		// Track hypernyms specifically
		if rel.Symbol == "@" {
			synset.HypernymIDs = append(synset.HypernymIDs, rel.TargetID)
		}

		idx += 4
	}

	return synset, nil
}

// ConvertToSemanticRelations converts WordNet synset relations to our domain model.
func ConvertToSemanticRelations(synset *Synset, sourceLexemeID int64, sourceWord string) []*entity.SemanticRelation {
	relations := make([]*entity.SemanticRelation, 0)

	for _, rel := range synset.Relations {
		// Map WordNet relation symbols to our relation types
		relType := MapWordNetRelation(rel.Symbol)
		if relType == "" {
			continue // Skip unmapped relations
		}

		// Use the first word from target synset as target term
		// In a full implementation, we'd load the target synset
		targetTerm := fmt.Sprintf("synset:%s", rel.TargetID)

		relations = append(relations, &entity.SemanticRelation{
			SourceLexemeID: sourceLexemeID,
			TargetLexemeID: nil, // Unresolved
			TargetTerm:     targetTerm,
			RelationType:   relType,
			Provider:       "wordnet",
			Strength:       1.0, // WordNet relations have uniform strength
			SenseMapped:    true,
		})
	}

	return relations
}

// MapWordNetRelation maps WordNet pointer symbols to our RelationType.
// Exported for use by Phase3.
func MapWordNetRelation(symbol string) string {
	switch symbol {
	case "@":
		return entity.RelationHypernym // is-a (parent)
	case "~":
		return entity.RelationHyponym // is-a (child)
	case "#m":
		return entity.RelationMemberHolonym // member of
	case "#p":
		return entity.RelationPartHolonym // part of
	case "%m":
		return entity.RelationMemberMeronym // has member
	case "%p":
		return entity.RelationPartMeronym // has part
	case "=":
		return entity.RelationAttribute // attribute
	case "!":
		return entity.RelationAntonym // opposite
	case "&":
		return entity.RelationSimilar // similar to
	case "<":
		return entity.RelationParticipleOf // verb form
	case "\\":
		return entity.RelationDerivedFrom // derived/related form
	case ";c":
		return entity.RelationCategory // domain category
	case "-c":
		return entity.RelationCategoryMember // member of category
	default:
		return "" // Unsupported
	}
}
