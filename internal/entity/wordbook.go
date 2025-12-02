package entity

import (
	"strings"
	"time"
)

// WordbookSource marks where the wordbook comes from.
type WordbookSource string

const (
	WordbookSourceBuiltin WordbookSource = "builtin"
	WordbookSourceUser    WordbookSource = "user"
)

// WordbookVisibility aligns with proto visibility values.
type WordbookVisibility string

const (
	WordbookVisibilityUnspecified WordbookVisibility = ""
	WordbookVisibilityPrivate     WordbookVisibility = "private"
	WordbookVisibilityPublic      WordbookVisibility = "public"
	WordbookVisibilityShared      WordbookVisibility = "shared"
)

// Wordbook aggregates vocabulary terms into a named collection.
type Wordbook struct {
	ID          int64
	UserID      int64
	Source      WordbookSource
	Language    Language
	Visibility  WordbookVisibility
	Name        string
	Description string
	Annotations map[string]string
	Terms       []string
	Stats       WordbookStats
	SortOrder   int32
	CreatedBy   string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// WordbookStats stores learning progress counters.
type WordbookStats struct {
	TotalWords    int32
	MasteredWords int32
	LearningWords int32
	UnknownWords  int32
}

// NormalizeWordbook cleans string fields, sets defaults, and ensures invariants.
func NormalizeWordbook(in *Wordbook) (*Wordbook, error) {
	if in == nil {
		return nil, ErrInvalidInput
	}

	out := *in
	out.Name = strings.TrimSpace(out.Name)
	out.Description = strings.TrimSpace(out.Description)
	out.Language = NormalizeLanguage(out.Language)
	if out.Visibility == WordbookVisibilityUnspecified {
		out.Visibility = WordbookVisibilityPublic
	}
	if out.Source == "" {
		if out.UserID == 0 {
			out.Source = WordbookSourceBuiltin
		} else {
			out.Source = WordbookSourceUser
		}
	}
	if out.Annotations == nil {
		out.Annotations = map[string]string{}
	}
	out.Terms = dedupeTerms(out.Terms)
	out.Stats.TotalWords = int32(len(out.Terms)) // simple derived metric for now

	if out.Name == "" {
		return nil, ErrInvalidWordbookName
	}

	return &out, nil
}

func dedupeTerms(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, term := range in {
		term = strings.TrimSpace(term)
		if term == "" {
			continue
		}
		if _, ok := seen[term]; ok {
			continue
		}
		seen[term] = struct{}{}
		out = append(out, term)
	}
	return out
}
