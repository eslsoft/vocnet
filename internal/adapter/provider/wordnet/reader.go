package wordnet

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
)

// Reader reads WordNet data files to extract synsets and relations.
type Reader struct {
	dataDir string
}

// NewReader creates a WordNet reader for the given data directory.
func NewReader(dataDir string) *Reader {
	return &Reader{dataDir: dataDir}
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

// LookupSynsets finds all synsets for a given word.
func (r *Reader) LookupSynsets(ctx context.Context, word string, pos string) ([]*Synset, error) {
	// Determine which data file to read based on POS
	var filename string
	switch pos {
	case "n", "noun":
		filename = "data.noun"
	case "v", "verb":
		filename = "data.verb"
	case "a", "adj", "adjective":
		filename = "data.adj"
	case "r", "adv", "adverb":
		filename = "data.adv"
	default:
		// Search all files
		synsets := make([]*Synset, 0)
		for _, pos := range []string{"noun", "verb", "adj", "adv"} {
			results, err := r.searchDataFile(ctx, word, fmt.Sprintf("data.%s", pos))
			if err != nil {
				continue
			}
			synsets = append(synsets, results...)
		}
		return synsets, nil
	}

	return r.searchDataFile(ctx, word, filename)
}

// GetHypernymPath retrieves the hypernym hierarchy path for a synset.
// This is used to calculate semantic depth.
func (r *Reader) GetHypernymPath(ctx context.Context, synset *Synset) ([]*Synset, error) {
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

		// Load hypernym synset
		hypernym, err := r.loadSynsetByID(ctx, hypernymID, current.POS)
		if err != nil {
			break
		}

		path = append(path, hypernym)
		visited[hypernymID] = true
		current = hypernym
	}

	return path, nil
}

// searchDataFile searches a specific WordNet data file for matching synsets.
func (r *Reader) searchDataFile(ctx context.Context, word string, filename string) ([]*Synset, error) {
	filePath := filepath.Join(r.dataDir, filename)
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("open wordnet file %s: %w", filename, err)
	}
	defer func() { _ = file.Close() }()

	synsets := make([]*Synset, 0)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB buffer

	normalizedWord := strings.ToLower(strings.ReplaceAll(word, " ", "_"))

	// First pass: collect exact case matches (prioritize lowercase)
	exactMatches := make([]*Synset, 0)
	caseInsensitiveMatches := make([]*Synset, 0)

	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		line := scanner.Text()
		if strings.HasPrefix(line, " ") || line == "" {
			continue // Skip license header
		}

		synset, err := r.parseSynsetLine(line)
		if err != nil {
			continue
		}

		// Check if word matches any word in this synset
		for _, w := range synset.Words {
			if w == word {
				// Exact case match (highest priority)
				exactMatches = append(exactMatches, synset)
				break
			} else if strings.ToLower(w) == normalizedWord {
				// Case-insensitive match (lower priority)
				caseInsensitiveMatches = append(caseInsensitiveMatches, synset)
				break
			}
		}
	}

	// Prioritize exact matches, then case-insensitive
	synsets = append(synsets, exactMatches...)
	synsets = append(synsets, caseInsensitiveMatches...)

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan file: %w", err)
	}

	return synsets, nil
}

// loadSynsetByID loads a specific synset by its offset ID.
func (r *Reader) loadSynsetByID(ctx context.Context, offset string, pos string) (*Synset, error) {
	var filename string
	switch pos {
	case "n":
		filename = "data.noun"
	case "v":
		filename = "data.verb"
	case "a":
		filename = "data.adj"
	case "r":
		filename = "data.adv"
	default:
		return nil, fmt.Errorf("unknown POS: %s", pos)
	}

	filePath := filepath.Join(r.dataDir, filename)
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("open file: %w", err)
	}
	defer func() { _ = file.Close() }()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		line := scanner.Text()
		if !strings.HasPrefix(line, offset) {
			continue
		}

		synset, err := r.parseSynsetLine(line)
		if err != nil {
			continue
		}

		if synset.Offset == offset {
			return synset, nil
		}
	}

	return nil, fmt.Errorf("synset not found: %s", offset)
}

// parseSynsetLine parses a WordNet data file line into a Synset struct.
// Format: synset_offset lex_filenum ss_type w_cnt word lex_id [word lex_id...] p_cnt [ptr...] [frames...] | gloss
func (r *Reader) parseSynsetLine(line string) (*Synset, error) {
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
