package store

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/eslsoft/vocnet/hack/dictinit/pkg/util"
	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entlemma "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lemma"
	entlexeme "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexeme"
	entlexemeform "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexemeform"
)

// ImportLexemeData contains all data needed for importing a complete lexeme entry.
type ImportLexemeData struct {
	Lexeme *entity.Lexeme
	Lemmas []*ImportLemmaData
}

// ImportLemmaData contains lemma and its forms for import.
type ImportLemmaData struct {
	Surface    string
	Normalized string
	Variant    string
	IsPrimary  bool
	Syllables  []string
	Forms      []*entity.LemmaForm
}

// LexemeImportService handles lexeme import operations using Ent client directly.
type LexemeImportService struct {
	client *entdb.Client
}

// NewLexemeImportService creates a new import service.
func NewLexemeImportService(client *entdb.Client) *LexemeImportService {
	return &LexemeImportService{client: client}
}

type SurfaceLexemeRef struct {
	ExternalID string
	Pos        string
}

// LoadExternalIDMap returns a map of normalized lemma surfaces to candidate Wikidata ExternalIDs.
// Note: A surface can map to multiple lexemes (different POS/senses). Callers should pick the best
// candidate (e.g. matching POS) instead of assuming uniqueness.
func (s *LexemeImportService) LoadExternalIDMap(ctx context.Context) (map[string][]SurfaceLexemeRef, error) {
	// NOTE: Do NOT eager-load Lexeme via WithLexeme() here.
	// Ent's eager-loading strategy issues a `WHERE id IN (...)` query for the edge
	// and will exceed PostgreSQL's 65535 parameter limit on large datasets.

	// 1) Load lexeme id -> (external_id, pos)
	lexemes, err := s.client.Lexeme.Query().
		Select(entlexeme.FieldID, entlexeme.FieldExternalID, entlexeme.FieldPos).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("load lexemes for id mapping: %w", err)
	}
	lexemeInfo := make(map[int64]SurfaceLexemeRef, len(lexemes))
	for _, lex := range lexemes {
		if lex == nil || lex.ID == 0 || lex.ExternalID == "" {
			continue
		}
		lexemeInfo[lex.ID] = SurfaceLexemeRef{
			ExternalID: lex.ExternalID,
			Pos:        lex.Pos,
		}
	}

	// 2) Load lemma normalized -> lexeme_id references
	lemmas, err := s.client.Lemma.Query().
		Select(entlemma.FieldNormalized, entlemma.FieldLexemeID).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("load lemma normalized map: %w", err)
	}

	surfaceToExternalIDs := make(map[string][]SurfaceLexemeRef, len(lemmas))
	seen := make(map[string]struct{}, len(lemmas))
	for _, l := range lemmas {
		if l == nil || l.Normalized == "" || l.LexemeID == 0 {
			continue
		}
		info, ok := lexemeInfo[l.LexemeID]
		if !ok || info.ExternalID == "" {
			continue
		}
		key := util.NormalizeKey(l.Normalized)
		dupKey := key + ":" + info.ExternalID
		if _, ok := seen[dupKey]; ok {
			continue
		}
		seen[dupKey] = struct{}{}
		surfaceToExternalIDs[key] = append(surfaceToExternalIDs[key], info)
	}

	return surfaceToExternalIDs, nil
}

// LoadKnownForms returns a normalized lookup of all lemma surfaces and lexeme forms in the database.
func (s *LexemeImportService) LoadKnownForms(ctx context.Context) (map[string]struct{}, error) {
	lemmas, err := s.client.Lemma.Query().
		Select(entlemma.FieldNormalized).
		Strings(ctx)
	if err != nil {
		return nil, fmt.Errorf("load lemmas: %w", err)
	}

	forms, err := s.client.LexemeForm.Query().
		Select(entlexemeform.FieldNormalized).
		Strings(ctx)
	if err != nil {
		return nil, fmt.Errorf("load forms: %w", err)
	}

	known := make(map[string]struct{}, len(lemmas)+len(forms))
	for _, lemma := range lemmas {
		key := util.NormalizeKey(lemma)
		if key != "" {
			known[key] = struct{}{}
		}
	}
	for _, form := range forms {
		key := util.NormalizeKey(form)
		if key != "" {
			known[key] = struct{}{}
		}
	}

	return known, nil
}

// FindAllLexemesByLemmaSurface finds ALL lexemes by lemma surface text (for enrichment).
// Unlike FindLexemeByLemmaSurface, this returns all matching lexemes (different POS/senses).
func (s *LexemeImportService) FindAllLexemesByLemmaSurface(ctx context.Context, surface string, language string) ([]*ImportLexemeData, error) {
	normalized := strings.ToLower(surface)

	// Find all lemmas with this surface text
	lemmas, err := s.client.Lemma.Query().
		Where(
			entlemma.NormalizedEQ(normalized),
		).
		WithForms().
		All(ctx) // ← Use All() instead of First()
	if err != nil {
		return nil, fmt.Errorf("query lemmas: %w", err)
	}

	if len(lemmas) == 0 {
		// Try to find in forms (inflected forms)
		forms, err := s.client.LexemeForm.Query().
			Where(entlexemeform.NormalizedEQ(normalized)).
			WithLemma(func(q *entdb.LemmaQuery) {
				q.WithForms()
			}).
			All(ctx)
		if err != nil {
			if entdb.IsNotFound(err) {
				return nil, nil // Not found is not an error
			}
			return nil, fmt.Errorf("query forms: %w", err)
		}

		// Collect unique lemmas from forms
		lemmaMap := make(map[int64]*entdb.Lemma)
		for _, form := range forms {
			if form.Edges.Lemma != nil {
				lemmaMap[form.Edges.Lemma.ID] = form.Edges.Lemma
			}
		}

		lemmas = make([]*entdb.Lemma, 0, len(lemmaMap))
		for _, lemma := range lemmaMap {
			lemmas = append(lemmas, lemma)
		}
	}

	// Build ImportLexemeData for each lemma
	results := make([]*ImportLexemeData, 0, len(lemmas))
	for _, lemma := range lemmas {
		data, err := s.buildImportDataFromLemma(ctx, lemma)
		if err != nil {
			// Log but continue with other lemmas
			log.Printf("[import-service] Warning: failed to build data for lemma %d: %v", lemma.ID, err)
			continue
		}
		if data != nil {
			// Filter by language if specified
			if language == "" || data.Lexeme.Language.Code() == language {
				results = append(results, data)
			}
		}
	}

	return results, nil
}

// FindLexemeByLemmaSurface finds a lexeme by its lemma surface text or any of its forms.
// It searches both the lemma table and lexeme_form table to handle inflected forms.
// NOTE: This returns only the FIRST match. Use FindAllLexemesByLemmaSurface for enrichment.
func (s *LexemeImportService) FindLexemeByLemmaSurface(ctx context.Context, surface string, language string) (*ImportLexemeData, error) {
	normalized := strings.ToLower(surface)

	// 1. Try to find lemma first (most common case)
	lemma, err := s.client.Lemma.Query().
		Where(
			entlemma.NormalizedEQ(normalized),
		).
		WithForms().
		First(ctx)

	if err == nil {
		// Found lemma, build result
		return s.buildImportDataFromLemma(ctx, lemma)
	}

	if !entdb.IsNotFound(err) {
		return nil, fmt.Errorf("query lemma: %w", err)
	}

	// 2. Lemma not found, try to find in forms (inflected forms like "ran", "running")
	form, err := s.client.LexemeForm.Query().
		Where(entlexemeform.NormalizedEQ(normalized)).
		WithLemma(func(q *entdb.LemmaQuery) {
			q.WithForms()
		}).
		First(ctx)

	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, nil // Not found is not an error for enrichment
		}
		return nil, fmt.Errorf("query form: %w", err)
	}

	// Found via form, get the associated lemma
	if form.Edges.Lemma == nil {
		return nil, fmt.Errorf("form %s has no associated lemma", surface)
	}

	return s.buildImportDataFromLemma(ctx, form.Edges.Lemma)
}

// buildImportDataFromLemma builds ImportLexemeData from a lemma entity.
func (s *LexemeImportService) buildImportDataFromLemma(ctx context.Context, lemma *entdb.Lemma) (*ImportLexemeData, error) {
	// Load the lexeme
	lexeme, err := s.client.Lexeme.Query().
		Where(entlexeme.IDEQ(lemma.LexemeID)).
		First(ctx)

	if err != nil {
		if entdb.IsNotFound(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("query lexeme: %w", err)
	}

	// Build ImportLexemeData from existing data
	result := &ImportLexemeData{
		Lexeme: &entity.Lexeme{
			ID:           lexeme.ID,
			ExternalID:   lexeme.ExternalID,
			Language:     entity.Language(lexeme.LanguageCode),
			PartOfSpeech: lexeme.Pos,
			EntryType:    entity.LexemeEntryType(lexeme.EntryType),
			Level:        lexeme.Level,
			Frequencies:  lexeme.Frequencies,
			SenseGloss:   lexeme.SenseGloss,
			Senses:       lexeme.Senses,
			Relations:    lexeme.Relations,
			Categories:   lexeme.Categories,
			Completeness: lexeme.Completeness,
		},
		Lemmas: []*ImportLemmaData{{
			Surface:    lemma.Surface,
			Normalized: lemma.Normalized,
			Variant:    lemma.Variant,
			IsPrimary:  lemma.IsPrimary,
			Forms:      convertEntFormsToEntity(lemma.Edges.Forms),
		}},
	}

	return result, nil
}

// convertEntFormsToEntity converts Ent forms to entity forms.
func convertEntFormsToEntity(entForms []*entdb.LexemeForm) []*entity.LemmaForm {
	forms := make([]*entity.LemmaForm, 0, len(entForms))
	for _, f := range entForms {
		forms = append(forms, &entity.LemmaForm{
			ID:          f.ID,
			LemmaID:     f.LemmaID,
			Surface:     f.Surface,
			Normalized:  f.Normalized,
			FormType:    entity.LexemeFormType(f.FormType),
			IsIrregular: f.IsIrregular,
			Phonetics:   f.Phonetics,
			Syllables:   f.Syllables,
		})
	}
	return forms
}

// CreateOrUpdateComplete creates or updates a complete lexeme entry with all lemmas and forms.
func (s *LexemeImportService) CreateOrUpdateComplete(ctx context.Context, data *ImportLexemeData) error {
	if data == nil || data.Lexeme == nil {
		return fmt.Errorf("invalid data")
	}
	if data.Lexeme.ExternalID == "" {
		return fmt.Errorf("external_id is required")
	}

	// Start transaction
	tx, err := s.client.Tx(ctx)
	if err != nil {
		return fmt.Errorf("start transaction: %w", err)
	}
	defer func() {
		if v := recover(); v != nil {
			_ = tx.Rollback()
			panic(v)
		}
	}()

	// Check if lexeme exists by external_id
	existingLexeme, err := tx.Lexeme.Query().
		Where(entlexeme.ExternalIDEQ(data.Lexeme.ExternalID)).
		WithLemmas(func(q *entdb.LemmaQuery) {
			q.WithForms()
		}).
		First(ctx)

	var lexemeRow *entdb.Lexeme
	if err != nil && !entdb.IsNotFound(err) {
		_ = tx.Rollback()
		return fmt.Errorf("query existing lexeme: %w", err)
	}

	if existingLexeme != nil {
		// Update existing lexeme
		lexemeRow, err = tx.Lexeme.UpdateOne(existingLexeme).
			SetLanguageCode(data.Lexeme.Language.CodeOrDefault()).
			SetPos(data.Lexeme.PartOfSpeech).
			SetEntryType(string(data.Lexeme.EntryType)).
			SetLevel(data.Lexeme.Level).
			SetFrequencies(data.Lexeme.Frequencies).
			SetSenseGloss(data.Lexeme.SenseGloss).
			SetSenses(mergeSenses(existingLexeme.Senses, data.Lexeme.Senses)).
			SetRelations(mergeRelations(existingLexeme.Relations, data.Lexeme.Relations)).
			SetCategories(MergeStringSlices(existingLexeme.Categories, data.Lexeme.Categories)).
			SetCompleteness(data.Lexeme.Completeness).
			Save(ctx)
		if err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("update lexeme: %w", err)
		}
	} else {
		// Create new lexeme
		lexemeCreate := tx.Lexeme.Create().
			SetExternalID(data.Lexeme.ExternalID).
			SetLanguageCode(data.Lexeme.Language.CodeOrDefault()).
			SetPos(data.Lexeme.PartOfSpeech).
			SetSenseGloss(data.Lexeme.SenseGloss).
			SetSenses(data.Lexeme.Senses).
			SetRelations(data.Lexeme.Relations).
			SetCategories(data.Lexeme.Categories).
			SetCompleteness(data.Lexeme.Completeness)

		if data.Lexeme.EntryType != "" {
			lexemeCreate.SetEntryType(string(data.Lexeme.EntryType))
		}
		if data.Lexeme.Level != "" {
			lexemeCreate.SetLevel(data.Lexeme.Level)
		}
		if len(data.Lexeme.Frequencies) > 0 {
			lexemeCreate.SetFrequencies(data.Lexeme.Frequencies)
		}

		lexemeRow, err = lexemeCreate.Save(ctx)
		if err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("create lexeme: %w", err)
		}
	}

	// Process lemmas and forms
	for _, lemmaData := range data.Lemmas {
		if err := s.createOrUpdateLemma(ctx, tx, lexemeRow.ID, lemmaData); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("process lemma %s: %w", lemmaData.Surface, err)
		}
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	return nil
}

// createOrUpdateLemma creates or updates a lemma with its forms within a transaction.
func (s *LexemeImportService) createOrUpdateLemma(ctx context.Context, tx *entdb.Tx, lexemeID int64, data *ImportLemmaData) error {
	if data == nil || data.Surface == "" {
		return fmt.Errorf("invalid lemma data")
	}
	if data.Normalized == "" {
		data.Normalized = strings.ToLower(data.Surface)
	}

	// Check if lemma exists
	existingLemma, err := tx.Lemma.Query().
		Where(
			entlemma.LexemeIDEQ(lexemeID),
			entlemma.SurfaceEQ(data.Surface),
		).
		WithForms().
		First(ctx)

	var lemmaRow *entdb.Lemma
	if err != nil && !entdb.IsNotFound(err) {
		return fmt.Errorf("query existing lemma: %w", err)
	}

	if existingLemma != nil {
		// Update existing lemma
		lemmaRow, err = tx.Lemma.UpdateOne(existingLemma).
			SetNormalized(data.Normalized).
			SetVariant(data.Variant).
			SetIsPrimary(data.IsPrimary).
			Save(ctx)
		if err != nil {
			return fmt.Errorf("update lemma: %w", err)
		}

		// Delete existing forms (we'll recreate them)
		if _, err := tx.LexemeForm.Delete().Where(entlexemeform.LemmaIDEQ(existingLemma.ID)).Exec(ctx); err != nil {
			return fmt.Errorf("delete old forms: %w", err)
		}
	} else {
		// Create new lemma
		lemmaRow, err = tx.Lemma.Create().
			SetLexemeID(lexemeID).
			SetSurface(data.Surface).
			SetNormalized(data.Normalized).
			SetVariant(data.Variant).
			SetIsPrimary(data.IsPrimary).
			Save(ctx)
		if err != nil {
			return fmt.Errorf("create lemma: %w", err)
		}
	}

	// Ensure the lemma itself is always included in the forms table
	hasLemmaInForms := false
	for _, f := range data.Forms {
		if strings.EqualFold(f.Normalized, data.Normalized) {
			hasLemmaInForms = true
			break
		}
	}
	if !hasLemmaInForms {
		data.Forms = append([]*entity.LemmaForm{{
			Surface:    data.Surface,
			Normalized: data.Normalized,
			FormType:   entity.LexemeFormTypeLemma,
		}}, data.Forms...)
	}

	// Create forms
	for _, form := range data.Forms {
		if form.Surface == "" {
			continue
		}
		if form.Normalized == "" {
			form.Normalized = strings.ToLower(form.Surface)
		}

		_, err := tx.LexemeForm.Create().
			SetLemmaID(lemmaRow.ID).
			SetSurface(form.Surface).
			SetNormalized(form.Normalized).
			SetFormType(string(form.FormType)).
			SetIsIrregular(form.IsIrregular).
			SetPhonetics(form.Phonetics).
			SetSyllables(form.Syllables).
			Save(ctx)
		if err != nil {
			return fmt.Errorf("create form %s: %w", form.Surface, err)
		}
	}

	return nil
}

// mergeSenses merges two sense arrays, avoiding duplicates.
func mergeSenses(existing, incoming []entity.LexemeSense) []entity.LexemeSense {
	if len(existing) == 0 {
		return incoming
	}
	if len(incoming) == 0 {
		return existing
	}

	seen := make(map[string]struct{})
	result := make([]entity.LexemeSense, 0, len(existing)+len(incoming))

	for _, sense := range existing {
		key := fmt.Sprintf("%s:%s", sense.Language.CodeOrDefault(), sense.Gloss)
		if _, ok := seen[key]; !ok {
			result = append(result, sense)
			seen[key] = struct{}{}
		}
	}

	for _, sense := range incoming {
		key := fmt.Sprintf("%s:%s", sense.Language.CodeOrDefault(), sense.Gloss)
		if _, ok := seen[key]; !ok {
			result = append(result, sense)
			seen[key] = struct{}{}
		}
	}

	return result
}

// mergeRelations merges two relation arrays, avoiding duplicates.
func mergeRelations(existing, incoming []entity.LexemeRelation) []entity.LexemeRelation {
	if len(existing) == 0 {
		return incoming
	}
	if len(incoming) == 0 {
		return existing
	}

	seen := make(map[string]struct{})
	result := make([]entity.LexemeRelation, 0, len(existing)+len(incoming))

	for _, rel := range existing {
		key := fmt.Sprintf("%s:%s:%d", rel.LexemeID, rel.TargetLexemeID, rel.RelationType)
		if _, ok := seen[key]; !ok {
			result = append(result, rel)
			seen[key] = struct{}{}
		}
	}

	for _, rel := range incoming {
		key := fmt.Sprintf("%s:%s:%d", rel.LexemeID, rel.TargetLexemeID, rel.RelationType)
		if _, ok := seen[key]; !ok {
			result = append(result, rel)
			seen[key] = struct{}{}
		}
	}

	return result
}

// mergeStringSlices merges two string slices, avoiding duplicates.
func MergeStringSlices(existing, incoming []string) []string {
	if len(existing) == 0 {
		return incoming
	}
	if len(incoming) == 0 {
		return existing
	}

	seen := make(map[string]struct{})
	result := make([]string, 0, len(existing)+len(incoming))

	for _, item := range existing {
		trimmed := strings.TrimSpace(item)
		if trimmed != "" {
			if _, ok := seen[trimmed]; !ok {
				result = append(result, trimmed)
				seen[trimmed] = struct{}{}
			}
		}
	}

	for _, item := range incoming {
		trimmed := strings.TrimSpace(item)
		if trimmed != "" {
			if _, ok := seen[trimmed]; !ok {
				result = append(result, trimmed)
				seen[trimmed] = struct{}{}
			}
		}
	}

	return result
}
