package pipeline

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// Persistence handles all database operations at stage boundaries.
type Persistence struct {
	lemmaRepo    repository.LemmaRepository
	lexemeRepo   repository.LexemeRepository
	evidenceRepo repository.EvidenceRepository
	relationRepo repository.SemanticRelationRepository
	snapshotRepo repository.WordSnapshotRepository
	aggregator   *DataAggregator
	logger       *slog.Logger
}

// NewPersistence creates a new Persistence service.
func NewPersistence(
	lemmaRepo repository.LemmaRepository,
	lexemeRepo repository.LexemeRepository,
	evidenceRepo repository.EvidenceRepository,
	relationRepo repository.SemanticRelationRepository,
	snapshotRepo repository.WordSnapshotRepository,
	aggregator *DataAggregator,
	logger *slog.Logger,
) *Persistence {
	return &Persistence{
		lemmaRepo:    lemmaRepo,
		lexemeRepo:   lexemeRepo,
		evidenceRepo: evidenceRepo,
		relationRepo: relationRepo,
		snapshotRepo: snapshotRepo,
		aggregator:   aggregator,
		logger:       logger,
	}
}

// SaveStageResult persists the accumulated result of a pipeline stage.
// Order: evidence → forms → lexemes (create or update) → relations.
func (p *Persistence) SaveStageResult(ctx context.Context, lemma *entity.Lemma, result *ProcessResult) error {
	if result == nil {
		return nil
	}

	// Save evidence
	for _, ev := range result.Evidence {
		ev.LemmaID = lemma.ID
		if _, err := p.evidenceRepo.Create(ctx, ev); err != nil {
			return fmt.Errorf("save evidence: %w", err)
		}
	}

	// Save forms (create new, merge existing)
	if err := p.saveForms(ctx, lemma.ID, result); err != nil {
		return fmt.Errorf("save forms: %w", err)
	}

	// Save or update lexemes
	if err := p.saveOrUpdateLexemes(ctx, lemma.ID, result.Lexemes); err != nil {
		return fmt.Errorf("save lexemes: %w", err)
	}

	// Save relations
	if len(result.Relations) > 0 {
		if _, err := p.relationRepo.BatchCreate(ctx, result.Relations); err != nil {
			return fmt.Errorf("save relations: %w", err)
		}
	}

	return nil
}

// SaveSnapshot persists a word snapshot.
func (p *Persistence) SaveSnapshot(ctx context.Context, snapshot *entity.WordSnapshot) error {
	_, err := p.snapshotRepo.CreateOrUpdate(ctx, snapshot)
	if err != nil {
		return fmt.Errorf("save snapshot: %w", err)
	}
	return nil
}

// collectUniqueForms deduplicates forms from the process result.
func collectUniqueForms(result *ProcessResult) []*entity.LemmaForm {
	if len(result.FormsByLexeme) == 0 {
		return result.Forms
	}

	var allForms []*entity.LemmaForm
	seen := make(map[string]bool)
	for _, forms := range result.FormsByLexeme {
		for _, form := range forms {
			key := formKey(form)
			if !seen[key] {
				allForms = append(allForms, form)
				seen[key] = true
			}
		}
	}
	return allForms
}

func formKey(f *entity.LemmaForm) string {
	return f.Surface + ":" + string(f.FormType)
}

// mergeExistingForm updates phonetics and syllables of an existing form.
func (p *Persistence) mergeExistingForm(ctx context.Context, lemmaID int64, existing, newForm *entity.LemmaForm) {
	if len(newForm.Phonetics) > 0 {
		merged := p.aggregator.MergePhonetics(existing.Phonetics, newForm.Phonetics)
		if len(merged) > len(existing.Phonetics) {
			if err := p.lemmaRepo.UpdateFormPhonetics(ctx, lemmaID, newForm.FormType, merged); err != nil {
				p.logger.Warn("failed to update form phonetics",
					"surface", newForm.Surface, "error", err)
			}
		}
	}
	if len(newForm.Syllables) > 0 {
		if err := p.lemmaRepo.UpdateFormSyllables(ctx, lemmaID, newForm.FormType, newForm.Syllables); err != nil {
			p.logger.Warn("failed to update form syllables",
				"surface", newForm.Surface, "error", err)
		}
	}
}

// saveForms persists or updates lemma forms from a stage result.
func (p *Persistence) saveForms(ctx context.Context, lemmaID int64, result *ProcessResult) error {
	allForms := collectUniqueForms(result)
	if len(allForms) == 0 {
		return nil
	}

	existingLemma, err := p.lemmaRepo.GetByID(ctx, lemmaID)
	if err != nil {
		return fmt.Errorf("get lemma: %w", err)
	}

	existingMap := make(map[string]*entity.LemmaForm)
	for _, f := range existingLemma.Forms {
		existingMap[formKey(f)] = f
	}

	var formsToCreate []entity.LemmaForm
	for _, newForm := range allForms {
		newForm.LemmaID = lemmaID
		if existing, ok := existingMap[formKey(newForm)]; ok {
			p.mergeExistingForm(ctx, lemmaID, existing, newForm)
		} else {
			formsToCreate = append(formsToCreate, *newForm)
		}
	}

	if len(formsToCreate) > 0 {
		if err := p.lemmaRepo.CreateForms(ctx, lemmaID, formsToCreate); err != nil {
			return fmt.Errorf("create forms: %w", err)
		}
	}

	return nil
}

// updateLexeme enriches and persists an existing lexeme, returning the enriched result.
func (p *Persistence) updateLexeme(ctx context.Context, existing, newLex *entity.Lexeme) (*entity.Lexeme, error) {
	enriched := p.aggregator.EnrichLexeme(existing, newLex)
	if _, err := p.lexemeRepo.Update(ctx, enriched); err != nil {
		return nil, fmt.Errorf("update lexeme %s: %w", newLex.ExternalID, err)
	}
	p.logger.Info("lexeme updated", "lexeme_id", enriched.ID, "external_id", enriched.ExternalID)
	return enriched, nil
}

// findExistingLexeme looks up a lexeme by ExternalID in the local cache, then in the DB.
func (p *Persistence) findExistingLexeme(ctx context.Context, extID string, cache map[string]*entity.Lexeme) *entity.Lexeme {
	if ex, ok := cache[extID]; ok {
		return ex
	}
	if dbLex, err := p.lexemeRepo.GetByExternalID(ctx, extID); err == nil {
		return dbLex
	}
	return nil
}

// saveOrUpdateLexemes creates new lexemes or updates existing ones.
func (p *Persistence) saveOrUpdateLexemes(ctx context.Context, lemmaID int64, lexemes []*entity.Lexeme) error {
	if len(lexemes) == 0 {
		return nil
	}

	existing, err := p.lexemeRepo.ListByLemmaID(ctx, lemmaID)
	if err != nil {
		p.logger.Warn("failed to list existing lexemes", "lemma_id", lemmaID, "error", err)
		existing = nil
	}

	existingByExtID := make(map[string]*entity.Lexeme)
	for _, lex := range existing {
		if lex.ExternalID != "" {
			existingByExtID[lex.ExternalID] = lex
		}
	}

	for _, newLex := range lexemes {
		newLex.LemmaID = lemmaID

		if newLex.ExternalID != "" {
			if found := p.findExistingLexeme(ctx, newLex.ExternalID, existingByExtID); found != nil {
				enriched, err := p.updateLexeme(ctx, found, newLex)
				if err != nil {
					return err
				}
				existingByExtID[newLex.ExternalID] = enriched
				continue
			}
		}

		if len(existing) > 0 && newLex.ExternalID == "" {
			if _, err := p.updateLexeme(ctx, existing[0], newLex); err != nil {
				return err
			}
		} else if newLex.ID == 0 {
			created, err := p.lexemeRepo.Create(ctx, newLex)
			if err != nil {
				return fmt.Errorf("create lexeme %s: %w", newLex.ExternalID, err)
			}
			existingByExtID[created.ExternalID] = created
			p.logger.Info("lexeme created", "lexeme_id", created.ID, "external_id", created.ExternalID)
		}
	}

	return nil
}
