package pipeline

import (
	"context"

	"github.com/eslsoft/vocnet/internal/adapter/provider/moby"
	"github.com/eslsoft/vocnet/internal/entity"
)

// MobyProcessor enriches forms with syllable data from Moby.
type MobyProcessor struct {
	reader *moby.Reader
}

// NewMobyProcessor creates a new MobyProcessor.
func NewMobyProcessor(reader *moby.Reader) *MobyProcessor {
	return &MobyProcessor{reader: reader}
}

func (p *MobyProcessor) Name() string { return "moby" }

func (p *MobyProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	if p.reader == nil {
		return nil, &ErrProcessorSkipped{Reason: "moby not available"}
	}

	if len(pctx.Forms) == 0 {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	var updatedForms []*entity.LemmaForm
	for _, form := range pctx.Forms {
		syllables, err := p.reader.Lookup(ctx, form.Surface)
		if err != nil || len(syllables) == 0 {
			continue
		}

		updated := *form
		updated.Syllables = syllables
		updatedForms = append(updatedForms, &updated)
	}

	if len(updatedForms) == 0 {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	return &ProcessResult{
		Status: ProcessStatusExecuted,
		Forms:  updatedForms,
	}, nil
}
