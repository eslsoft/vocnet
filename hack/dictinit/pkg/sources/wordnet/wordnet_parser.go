package wordnet

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

type RelationCandidate struct {
	TargetTerm   string
	RelationType int32
	SourcePOS    string
	TargetPOS    string
}

type RelationIndex struct {
	items map[string][]RelationCandidate
	seen  map[string]struct{}
}

type ParseStats struct {
	Files       []string
	Synsets     int
	Relations   int
	SkippedLine int
}

func newRelationIndex() *RelationIndex {
	return &RelationIndex{
		items: make(map[string][]RelationCandidate),
		seen:  make(map[string]struct{}),
	}
}

func (ri *RelationIndex) Add(sourceTerm, sourcePOS, targetTerm, targetPOS string, relType int32) bool {
	sourceTerm = normalizeSurface(sourceTerm)
	targetTerm = normalizeSurface(targetTerm)
	if sourceTerm == "" || targetTerm == "" {
		return false
	}
	if sourceTerm == targetTerm {
		return false
	}

	sourceKey := normalizeKey(sourceTerm)
	targetKey := normalizeKey(targetTerm)
	if sourceKey == "" || targetKey == "" {
		return false
	}

	key := fmt.Sprintf("%s|%s|%s|%s|%d", sourceKey, sourcePOS, targetKey, targetPOS, relType)
	if _, ok := ri.seen[key]; ok {
		return false
	}
	ri.seen[key] = struct{}{}

	ri.items[sourceKey] = append(ri.items[sourceKey], RelationCandidate{
		TargetTerm:   targetTerm,
		RelationType: relType,
		SourcePOS:    sourcePOS,
		TargetPOS:    targetPOS,
	})
	return true
}

func (ri *RelationIndex) Keys() []string {
	keys := make([]string, 0, len(ri.items))
	for k := range ri.items {
		keys = append(keys, k)
	}
	return keys
}

func (ri *RelationIndex) Get(sourceKey string) []RelationCandidate {
	return ri.items[sourceKey]
}

type Synset struct {
	Offset   string
	POS      string
	Words    []string
	Pointers []Pointer
}

type Pointer struct {
	Symbol       string
	TargetOffset string
	TargetPOS    string
	SourceIndex  int
	TargetIndex  int
}

func BuildRelationIndexFromDir(dir string) (*RelationIndex, *ParseStats, error) {
	files := []string{"data.noun", "data.verb", "data.adj", "data.adv", "data.sat"}
	index := newRelationIndex()
	stats := &ParseStats{}

	for _, name := range files {
		path := filepath.Join(dir, name)
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, stats, fmt.Errorf("stat wordnet file %s: %w", path, err)
		}
		stats.Files = append(stats.Files, path)

		synsets, err := parseWordNetFile(path, stats)
		if err != nil {
			return nil, stats, err
		}
		buildRelationsFromSynsets(synsets, index, stats)
	}

	return index, stats, nil
}

func parseWordNetFile(path string, stats *ParseStats) (map[string]*Synset, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open wordnet file %s: %w", path, err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)

	synsets := make(map[string]*Synset)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if line[0] < '0' || line[0] > '9' {
			continue
		}

		synset, err := parseWordNetLine(line)
		if err != nil {
			if stats != nil {
				stats.SkippedLine++
			}
			continue
		}
		key := synsetKey(synset.Offset, synset.POS)
		synsets[key] = synset
		if stats != nil {
			stats.Synsets++
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan wordnet file %s: %w", path, err)
	}

	return synsets, nil
}

func parseWordNetLine(line string) (*Synset, error) {
	parts := strings.SplitN(line, "|", 2)
	fields := strings.Fields(parts[0])
	if len(fields) < 4 {
		return nil, fmt.Errorf("invalid line")
	}

	offset := fields[0]
	pos := fields[2]
	wordCount, err := strconv.ParseInt(fields[3], 16, 32)
	if err != nil {
		return nil, fmt.Errorf("parse word count: %w", err)
	}

	idx := 4
	words := make([]string, 0, wordCount)
	for i := int64(0); i < wordCount; i++ {
		if idx+1 >= len(fields) {
			return nil, fmt.Errorf("unexpected word fields")
		}
		word := strings.ReplaceAll(fields[idx], "_", " ")
		words = append(words, word)
		idx += 2
	}

	if idx >= len(fields) {
		return nil, fmt.Errorf("missing pointer count")
	}
	ptrCount, err := strconv.Atoi(fields[idx])
	if err != nil {
		return nil, fmt.Errorf("parse pointer count: %w", err)
	}
	idx++

	pointers := make([]Pointer, 0, ptrCount)
	for i := 0; i < ptrCount; i++ {
		if idx+3 >= len(fields) {
			return nil, fmt.Errorf("unexpected pointer fields")
		}
		ptr := Pointer{
			Symbol:       fields[idx],
			TargetOffset: fields[idx+1],
			TargetPOS:    fields[idx+2],
		}
		sourceIdx, targetIdx := parseSourceTarget(fields[idx+3])
		ptr.SourceIndex = sourceIdx
		ptr.TargetIndex = targetIdx
		pointers = append(pointers, ptr)
		idx += 4
	}

	return &Synset{
		Offset:   offset,
		POS:      pos,
		Words:    words,
		Pointers: pointers,
	}, nil
}

func parseSourceTarget(value string) (int, int) {
	if len(value) != 4 {
		return 0, 0
	}
	parsed, err := strconv.ParseInt(value, 16, 32)
	if err != nil {
		return 0, 0
	}
	source := int(parsed >> 8)
	target := int(parsed & 0xFF)
	return source, target
}

//nolint:gocognit // Relationship expansion is centralized here to avoid extra allocations.
func buildRelationsFromSynsets(synsets map[string]*Synset, index *RelationIndex, stats *ParseStats) {
	for _, synset := range synsets {
		sourcePOS := wordNetPOSToStandard(synset.POS)
		if len(synset.Words) > 1 {
			for i, sourceWord := range synset.Words {
				for j, targetWord := range synset.Words {
					if i == j {
						continue
					}
					if index.Add(sourceWord, sourcePOS, targetWord, sourcePOS, int32(dictv1.RelationType_RELATION_TYPE_SYNONYM)) {
						if stats != nil {
							stats.Relations++
						}
					}
				}
			}
		}

		for _, ptr := range synset.Pointers {
			relType, ok := pointerToRelationType(ptr.Symbol)
			if !ok {
				continue
			}

			targetSynset, ok := synsets[synsetKey(ptr.TargetOffset, ptr.TargetPOS)]
			if !ok || len(targetSynset.Words) == 0 {
				continue
			}
			targetPOS := wordNetPOSToStandard(targetSynset.POS)

			sourceWords := selectWords(synset.Words, ptr.SourceIndex)
			targetWords := selectWords(targetSynset.Words, ptr.TargetIndex)
			for _, sourceWord := range sourceWords {
				for _, targetWord := range targetWords {
					if index.Add(sourceWord, sourcePOS, targetWord, targetPOS, int32(relType)) {
						if stats != nil {
							stats.Relations++
						}
					}
				}
			}
		}
	}
}

func selectWords(words []string, index int) []string {
	if index <= 0 {
		return words
	}
	if index-1 >= len(words) {
		return nil
	}
	return []string{words[index-1]}
}

func pointerToRelationType(symbol string) (dictv1.RelationType, bool) {
	switch symbol {
	case "!":
		return dictv1.RelationType_RELATION_TYPE_ANTONYM, true
	case "@", "@i":
		return dictv1.RelationType_RELATION_TYPE_HYPERNYM, true
	case "~", "~i":
		return dictv1.RelationType_RELATION_TYPE_HYPONYM, true
	case "+":
		return dictv1.RelationType_RELATION_TYPE_DERIVATIVE, true
	case "#m", "#s", "#p", "%m", "%s", "%p":
		return dictv1.RelationType_RELATION_TYPE_PART_WHOLE, true
	case ">":
		return dictv1.RelationType_RELATION_TYPE_CAUSE_EFFECT, true
	case "&", "^", "\\", "=":
		return dictv1.RelationType_RELATION_TYPE_ASSOCIATION, true
	default:
		return 0, false
	}
}

func wordNetPOSToStandard(code string) string {
	switch strings.ToLower(strings.TrimSpace(code)) {
	case "n":
		return "n."
	case "v":
		return "v."
	case "a", "s":
		return "adj."
	case "r":
		return "adv."
	default:
		return ""
	}
}

func normalizeKey(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizeSurface(value string) string {
	return strings.TrimSpace(value)
}

func synsetKey(offset, pos string) string {
	return offset + "|" + pos
}
