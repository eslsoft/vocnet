package pipeline

import (
	"context"
	"fmt"
	"time"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/entity"
)

// Phase1Discovery implements the discovery phase (Wikidata QID anchoring).
type Phase1Discovery struct {
	wikidata provider.WikidataProvider
}

func NewPhase1Discovery(wikidata provider.WikidataProvider) *Phase1Discovery {
	return &Phase1Discovery{wikidata: wikidata}
}

func (p *Phase1Discovery) Name() string {
	return entity.PhaseDiscovery.Name()
}

func (p *Phase1Discovery) Number() int {
	return int(entity.PhaseDiscovery)
}

func (p *Phase1Discovery) Execute(ctx context.Context, lemma *entity.Lemma) (*PhaseResult, error) {
	lang := entity.ParseLanguage("en") // TODO: get from lemma context
	if lemma.Surface == "" {
		return nil, fmt.Errorf("lemma surface is empty")
	}

	// Search for Wikidata entity
	entityResult, err := p.wikidata.SearchEntity(ctx, lemma.Surface, lang.Code())
	if err != nil {
		return nil, fmt.Errorf("wikidata search: %w", err)
	}

	if entityResult == nil || entityResult.QID == "" {
		// No QID found - not an error, just skip
		return &PhaseResult{}, nil
	}

	// Update lemma with QID
	updatedLemma := *lemma
	updatedLemma.WikidataQID = entityResult.QID

	// Fetch lexemes for this term
	lexemes, rawResp, err := p.wikidata.FetchLexemes(ctx, lemma.Surface, lang.Code())
	if err != nil {
		return nil, fmt.Errorf("fetch lexemes: %w", err)
	}

	// Create evidence
	evidence := &entity.RawEvidence{
		Provider:      "wikidata",
		Phase:         int32(p.Number()),
		Content:       rawResp,
		SchemaVersion: "wikidata-2025",
		FetchedAt:     time.Now(),
	}

	// Convert provider lexemes to entity lexemes
	entityLexemes := make([]*entity.Lexeme, 0, len(lexemes))
	for _, lex := range lexemes {
		senses := make([]entity.LexemeSense, 0, len(lex.Senses))
		for _, s := range lex.Senses {
			for lang, gloss := range s.Glosses {
				senses = append(senses, entity.LexemeSense{
					Language: entity.ParseLanguage(lang),
					Gloss:    gloss,
				})
			}
		}

		entityLexemes = append(entityLexemes, &entity.Lexeme{
			ExternalID:   lex.LexemeID,
			Language:     entity.ParseLanguage(lex.Language),
			PartOfSpeech: lex.POS,
			EntryType:    entity.LexemeEntryTypeWord,
			Senses:       senses,
		})
	}

	return &PhaseResult{
		Evidence:    []*entity.RawEvidence{evidence},
		Lexemes:     entityLexemes,
		LemmaUpdate: &updatedLemma,
	}, nil
}
