package cefrj

import (
	"context"
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

var cefrOrder = map[string]int{
	"A1": 1,
	"A2": 2,
	"B1": 3,
	"B2": 4,
	"C1": 5,
	"C2": 6,
}

// Entry represents CEFR-J data for a lookup term.
type Entry struct {
	Headword     string
	MinLevel     string
	LevelsByPOS  map[string]string
	MatchedForms []string
}

// Reader provides CEFR-J vocabulary lookup from CSV data.
type Reader struct {
	paths []string
	index map[string]*Entry // normalized term -> aggregated entry
}

// NewReader creates a CEFR-J reader from a directory containing CSV files.
func NewReader(csvDir string) (*Reader, error) {
	csvDir = strings.TrimSpace(csvDir)
	if csvDir == "" {
		return nil, fmt.Errorf("cefrj csv directory is required")
	}
	info, err := os.Stat(csvDir)
	if err != nil {
		return nil, fmt.Errorf("stat cefrj directory %q: %w", csvDir, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("cefrj path %q is not a directory", csvDir)
	}

	paths, err := collectCSVPathsFromDir(csvDir)
	if err != nil {
		return nil, err
	}

	r := &Reader{paths: paths, index: make(map[string]*Entry)}
	for _, csvPath := range paths {
		if err := r.loadCSV(csvPath); err != nil {
			return nil, err
		}
	}
	if len(r.index) == 0 {
		return nil, fmt.Errorf("cefrj csv parsed but no valid rows")
	}

	return r, nil
}

func collectCSVPathsFromDir(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read cefrj directory %q: %w", dir, err)
	}

	paths := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.ToLower(filepath.Ext(entry.Name())) != ".csv" {
			continue
		}
		paths = append(paths, filepath.Join(dir, entry.Name()))
	}
	if len(paths) == 0 {
		return nil, fmt.Errorf("no cefrj csv files found in %s", dir)
	}
	sort.Strings(paths)
	return paths, nil
}

func (r *Reader) loadCSV(csvPath string) error {
	f, err := os.Open(csvPath)
	if err != nil {
		return fmt.Errorf("open cefrj csv %q: %w", csvPath, err)
	}
	defer func() { _ = f.Close() }()

	cr := csv.NewReader(f)
	cr.FieldsPerRecord = -1
	records, err := cr.ReadAll()
	if err != nil {
		return fmt.Errorf("read cefrj csv %q: %w", csvPath, err)
	}
	if len(records) < 2 {
		return fmt.Errorf("cefrj csv %q has no data rows", csvPath)
	}

	for _, row := range records[1:] {
		if len(row) < 3 {
			continue
		}

		headword := strings.TrimSpace(row[0])
		pos := strings.ToLower(strings.TrimSpace(row[1]))
		level := strings.ToUpper(strings.TrimSpace(row[2]))
		if headword == "" || pos == "" || !isValidCEFR(level) {
			continue
		}

		for _, form := range expandHeadwordForms(headword) {
			norm := normalize(form)
			if norm == "" {
				continue
			}

			ent, ok := r.index[norm]
			if !ok {
				ent = &Entry{
					Headword:     headword,
					MinLevel:     level,
					LevelsByPOS:  map[string]string{pos: level},
					MatchedForms: []string{form},
				}
				r.index[norm] = ent
				continue
			}

			ent.MinLevel = minLevel(ent.MinLevel, level)
			if cur, exists := ent.LevelsByPOS[pos]; !exists {
				ent.LevelsByPOS[pos] = level
			} else {
				ent.LevelsByPOS[pos] = minLevel(cur, level)
			}
			if !containsFold(ent.MatchedForms, form) {
				ent.MatchedForms = append(ent.MatchedForms, form)
			}
		}
	}

	return nil
}

// Lookup finds CEFR-J entry by term (case-insensitive).
func (r *Reader) Lookup(ctx context.Context, term string) (*Entry, error) {
	_ = ctx
	if r == nil {
		return nil, fmt.Errorf("cefrj reader is nil")
	}
	norm := normalize(term)
	if norm == "" {
		return nil, nil
	}
	ent, ok := r.index[norm]
	if !ok {
		return nil, nil
	}

	// Return a copy to avoid accidental mutation by callers.
	levels := make(map[string]string, len(ent.LevelsByPOS))
	for k, v := range ent.LevelsByPOS {
		levels[k] = v
	}
	forms := make([]string, len(ent.MatchedForms))
	copy(forms, ent.MatchedForms)
	sort.Strings(forms)

	return &Entry{
		Headword:     ent.Headword,
		MinLevel:     ent.MinLevel,
		LevelsByPOS:  levels,
		MatchedForms: forms,
	}, nil
}

func isValidCEFR(level string) bool {
	_, ok := cefrOrder[level]
	return ok
}

func minLevel(a, b string) string {
	a = strings.ToUpper(strings.TrimSpace(a))
	b = strings.ToUpper(strings.TrimSpace(b))
	if !isValidCEFR(a) {
		return b
	}
	if !isValidCEFR(b) {
		return a
	}
	if cefrOrder[a] <= cefrOrder[b] {
		return a
	}
	return b
}

func normalize(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

func expandHeadwordForms(headword string) []string {
	headword = strings.TrimSpace(headword)
	if headword == "" {
		return nil
	}

	parts := strings.Split(headword, "/")
	out := make([]string, 0, len(parts)+1)
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return []string{headword}
	}
	return out
}

func containsFold(items []string, item string) bool {
	for _, it := range items {
		if strings.EqualFold(it, item) {
			return true
		}
	}
	return false
}
