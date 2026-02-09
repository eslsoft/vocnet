package pipeline

import (
	"context"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/adapter/provider/cefrj"
	"github.com/eslsoft/vocnet/internal/entity"
)

// CEFRJProcessor enriches lemma level from CEFR-J vocabulary profile.
type CEFRJProcessor struct {
	reader *cefrj.Reader
}

// NewCEFRJProcessor creates a CEFR-J processor.
func NewCEFRJProcessor(reader *cefrj.Reader) *CEFRJProcessor {
	return &CEFRJProcessor{reader: reader}
}

func (p *CEFRJProcessor) Name() string { return "cefrj" }

func (p *CEFRJProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	if p.reader == nil {
		return nil, &ErrProcessorSkipped{Reason: "cefrj not available"}
	}
	if pctx == nil || pctx.Lemma == nil {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	entry, err := p.reader.Lookup(ctx, pctx.Term)
	if err != nil {
		return nil, err
	}
	if entry == nil || entry.MinLevel == "" {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	updated := *pctx.Lemma
	if updated.Level == "" {
		updated.Level = entry.MinLevel
	} else {
		updated.Level = minCEFRLevel(updated.Level, entry.MinLevel)
	}

	evidence := &entity.RawEvidence{
		Provider:      "cefrj",
		Phase:         int32(entity.PhaseLexical),
		Content:       buildCEFRJEvidence(entry),
		SchemaVersion: "cefrj-1.5+c1c2-1.0",
		FetchedAt:     time.Now(),
	}

	return &ProcessResult{
		Status:      ProcessStatusExecuted,
		Evidence:    []*entity.RawEvidence{evidence},
		LemmaUpdate: &updated,
	}, nil
}

func minCEFRLevel(a, b string) string {
	a = strings.ToUpper(strings.TrimSpace(a))
	b = strings.ToUpper(strings.TrimSpace(b))
	order := map[string]int{"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}
	av, aok := order[a]
	bv, bok := order[b]
	switch {
	case !aok:
		return b
	case !bok:
		return a
	case av <= bv:
		return a
	default:
		return b
	}
}

func buildCEFRJEvidence(entry *cefrj.Entry) map[string]any {
	levelsByPOS := make(map[string]any, len(entry.LevelsByPOS))
	for pos, lv := range entry.LevelsByPOS {
		levelsByPOS[pos] = lv
	}

	matchedForms := make([]any, 0, len(entry.MatchedForms))
	for _, f := range entry.MatchedForms {
		matchedForms = append(matchedForms, f)
	}

	return map[string]any{
		"headword":      entry.Headword,
		"min_level":     entry.MinLevel,
		"levels_by_pos": levelsByPOS,
		"matched_forms": matchedForms,
	}
}
