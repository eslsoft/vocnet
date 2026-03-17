package persist

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline/scoring"
)

// Persistence handles all database operations at stage boundaries.
type Persistence struct {
	lemmaRepo    repository.LemmaRepository
	lexemeRepo   repository.LexemeRepository
	evidenceRepo repository.EvidenceRepository
	relationRepo repository.SemanticRelationRepository
	snapshotRepo repository.LemmaSnapshotRepository
	logger       *slog.Logger
}

// NewPersistence creates a new Persistence service.
func NewPersistence(
	lemmaRepo repository.LemmaRepository,
	lexemeRepo repository.LexemeRepository,
	evidenceRepo repository.EvidenceRepository,
	relationRepo repository.SemanticRelationRepository,
	snapshotRepo repository.LemmaSnapshotRepository,
	logger *slog.Logger,
) *Persistence {
	return &Persistence{
		lemmaRepo:    lemmaRepo,
		lexemeRepo:   lexemeRepo,
		evidenceRepo: evidenceRepo,
		relationRepo: relationRepo,
		snapshotRepo: snapshotRepo,
		logger:       logger,
	}
}

// SaveEvidence persists raw source evidence. Called by the engine after Collection.
func (p *Persistence) SaveEvidence(ctx context.Context, lemma *entity.Lemma, evidence []*entity.RawEvidence) error {
	for _, ev := range evidence {
		ev.LemmaID = lemma.ID
		if _, err := p.evidenceRepo.Create(ctx, ev); err != nil {
			return fmt.Errorf("save evidence: %w", err)
		}
	}
	return nil
}

// SaveIntegrationResult persists forms, lexemes, and relations.
// Called by the engine after the Integration stage — the single authoritative
// point where evaluated, scored data is written to the database.
func (p *Persistence) SaveIntegrationResult(ctx context.Context, lemma *entity.Lemma, result *scoring.ProcessResult) error {
	if result == nil {
		return nil
	}

	// Save forms (create new, merge existing, delete stale)
	if err := p.saveForms(ctx, lemma.ID, result); err != nil {
		return fmt.Errorf("save forms: %w", err)
	}

	// Save or update lexemes
	if err := p.saveOrUpdateLexemes(ctx, lemma.ID, result.Lexemes); err != nil {
		return fmt.Errorf("save lexemes: %w", err)
	}

	// Save relations (resolve ExternalID → DB SourceLexemeID first)
	if len(result.Relations) > 0 {
		p.mapUnmappedContribRelations(result.Relations, result.Lexemes)

		if err := p.resolveRelationIDs(ctx, result.Relations); err != nil {
			return fmt.Errorf("resolve relation IDs: %w", err)
		}
		relations := deduplicateRelations(result.Relations)

		// Filter out relations with unresolved SourceLexemeID
		validRelations := make([]*entity.SemanticRelation, 0, len(relations))
		skippedCount := 0
		for _, rel := range relations {
			if rel.SourceLexemeID == 0 {
				skippedCount++
				continue
			}
			validRelations = append(validRelations, rel)
		}
		if skippedCount > 0 {
			p.logger.Debug("skipped relations with unresolved source lexemes",
				"skipped", skippedCount,
				"total", len(relations))
		}

		relations, err := p.filterExistingUniqueRelations(ctx, validRelations)
		if err != nil {
			return fmt.Errorf("filter existing relations: %w", err)
		}
		if _, err := p.relationRepo.BatchCreate(ctx, relations); err != nil {
			return fmt.Errorf("save relations: %w", err)
		}
	}

	return nil
}

// SaveLemmaSnapshot persists a new snapshot version for a lemma.
func (p *Persistence) SaveLemmaSnapshot(ctx context.Context, jobID int64, lemma *entity.Lemma, forms []*entity.LemmaForm, snapshot *entity.LemmaSnapshot) error {
	if lemma == nil {
		return fmt.Errorf("lemma is required")
	}

	// Update the lemma entity with any changes (e.g., CEFR level from integration)
	_, err := p.lemmaRepo.Update(ctx, lemma)
	if err != nil {
		return fmt.Errorf("update lemma: %w", err)
	}

	terms := collectLemmaSnapshotLookupTerms(lemma, forms)
	snapshot.LemmaID = lemma.ID
	snapshot.JobID = &jobID
	snapshot.LookupTerms = terms
	snapshot.IsLatest = true
	_, err = p.snapshotRepo.CreateOrUpdate(ctx, snapshot)
	if err != nil {
		return fmt.Errorf("save snapshot: %w", err)
	}
	return nil
}

func collectLemmaSnapshotLookupTerms(lemma *entity.Lemma, forms []*entity.LemmaForm) []string {
	seen := make(map[string]struct{})
	terms := make([]string, 0, 1+len(forms))

	appendTerm := func(v string) {
		v = strings.ToLower(strings.TrimSpace(v))
		if v == "" {
			return
		}
		if _, ok := seen[v]; ok {
			return
		}
		seen[v] = struct{}{}
		terms = append(terms, v)
	}

	if lemma != nil {
		appendTerm(lemma.Surface)
	}
	for _, f := range forms {
		if f == nil {
			continue
		}
		appendTerm(f.Surface)
	}
	return terms
}

// collectUniqueForms deduplicates forms from the process result.
func collectUniqueForms(result *scoring.ProcessResult) []*entity.LemmaForm {
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
	if existing.IsIrregular != newForm.IsIrregular {
		if err := p.lemmaRepo.UpdateFormIrregular(ctx, lemmaID, existing.Surface, existing.FormType, newForm.IsIrregular); err != nil {
			p.logger.Warn("failed to update form irregular flag",
				"surface", newForm.Surface, "error", err)
		}
	}
	if len(newForm.Phonetics) > 0 {
		merged := scoring.MergePhonetics(existing.Phonetics, newForm.Phonetics)
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

// saveForms persists or updates lemma forms from the Integration stage result.
func (p *Persistence) saveForms(ctx context.Context, lemmaID int64, result *scoring.ProcessResult) error {
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
	enriched := scoring.EnrichLexeme(existing, newLex)
	if _, err := p.lexemeRepo.Update(ctx, enriched); err != nil {
		return nil, fmt.Errorf("update lexeme %s: %w", newLex.ExternalID, err)
	}
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

		switch {
		case len(existing) > 0 && newLex.ExternalID == "":
			if _, err := p.updateLexeme(ctx, existing[0], newLex); err != nil {
				return err
			}
		case newLex.ID == 0 && newLex.ExternalID != "":
			// Only create new lexemes if they have ExternalID (from Wikidata)
			created, err := p.lexemeRepo.Create(ctx, newLex)
			if err != nil {
				return fmt.Errorf("create lexeme %s: %w", newLex.ExternalID, err)
			}
			existingByExtID[created.ExternalID] = created
		case newLex.ExternalID == "":
			// Lexemes without ExternalID (from contrib sources) can only enrich existing lexemes
			// If no existing lexeme to enrich, skip this lexeme
		}
	}

	return nil
}

// resolveRelationIDs resolves SourceExternalID → DB SourceLexemeID for all relations.
func (p *Persistence) resolveRelationIDs(ctx context.Context, relations []*entity.SemanticRelation) error {
	sourceLexemeByExternalID := p.loadRelationLexemeIndex(ctx, relations)
	targetLookup := p.loadRelationTargetLookup(ctx, relations, sourceLexemeByExternalID)
	for _, rel := range relations {
		srcLex := sourceLexemeByExternalID[rel.SourceExternalID]
		if srcLex == nil {
			continue
		}
		rel.SourceLexemeID = srcLex.ID

		p.resolveRelationTarget(rel, srcLex, sourceLexemeByExternalID, targetLookup)
	}
	return nil
}

func collectExternalIDsForRelations(relations []*entity.SemanticRelation) map[string]bool {
	extIDs := make(map[string]bool)
	for _, rel := range relations {
		if rel == nil {
			continue
		}
		if rel.SourceExternalID != "" {
			extIDs[rel.SourceExternalID] = true
		}
		if ext := parseWikidataLexemeRef(rel.TargetRef); ext != "" {
			extIDs[ext] = true
		}
	}
	return extIDs
}

func (p *Persistence) loadRelationLexemeIndex(ctx context.Context, relations []*entity.SemanticRelation) map[string]*entity.Lexeme {
	extIDs := collectExternalIDsForRelations(relations)
	if len(extIDs) == 0 {
		return map[string]*entity.Lexeme{}
	}

	// Batch lookup all external IDs in a single query
	ids := make([]string, 0, len(extIDs))
	for id := range extIDs {
		ids = append(ids, id)
	}
	result, err := p.lexemeRepo.BatchGetByExternalIDs(ctx, ids)
	if err != nil {
		p.logger.Warn("batch resolve lexeme ExternalIDs failed, falling back to individual lookups",
			"count", len(ids), "error", err)
		// Fallback to individual lookups
		result = make(map[string]*entity.Lexeme, len(ids))
		for _, id := range ids {
			lex, err := p.lexemeRepo.GetByExternalID(ctx, id)
			if err != nil {
				continue
			}
			result[id] = lex
		}
	}
	return result
}

func collectTargetTermsByLanguage(relations []*entity.SemanticRelation, sourceLexemeByExternalID map[string]*entity.Lexeme) map[entity.Language]map[string]struct{} {
	targetTermsByLang := make(map[entity.Language]map[string]struct{})
	for _, rel := range relations {
		if rel == nil {
			continue
		}
		srcLex := sourceLexemeByExternalID[rel.SourceExternalID]
		if srcLex == nil {
			continue
		}
		if rel.TargetLexemeID != nil || strings.TrimSpace(rel.TargetTerm) == "" {
			continue
		}
		lang := srcLex.Language
		if targetTermsByLang[lang] == nil {
			targetTermsByLang[lang] = make(map[string]struct{})
		}
		for _, candidate := range relationTargetLookupTerms(rel.TargetTerm) {
			targetTermsByLang[lang][candidate] = struct{}{}
		}
	}
	return targetTermsByLang
}

func (p *Persistence) loadRelationTargetLookup(ctx context.Context, relations []*entity.SemanticRelation, sourceLexemeByExternalID map[string]*entity.Lexeme) map[entity.Language]map[string][]*repository.LemmaFormInfo {
	targetTermsByLang := collectTargetTermsByLanguage(relations, sourceLexemeByExternalID)
	targetLookup := make(map[entity.Language]map[string][]*repository.LemmaFormInfo, len(targetTermsByLang))
	for lang, termSet := range targetTermsByLang {
		terms := make([]string, 0, len(termSet))
		for term := range termSet {
			terms = append(terms, term)
		}
		info, err := p.lexemeRepo.BatchLookupFormInfo(ctx, terms, lang)
		if err != nil {
			p.logger.Warn("failed to batch resolve relation targets", "language", lang, "error", err)
			continue
		}
		targetLookup[lang] = info
	}
	return targetLookup
}

func (p *Persistence) resolveRelationTarget(
	rel *entity.SemanticRelation,
	srcLex *entity.Lexeme,
	sourceLexemeByExternalID map[string]*entity.Lexeme,
	targetLookup map[entity.Language]map[string][]*repository.LemmaFormInfo,
) {
	if rel.TargetLexemeID != nil {
		if strings.TrimSpace(rel.TargetRef) == "" {
			rel.TargetRef = internalLexemeRef(*rel.TargetLexemeID)
		}
		return
	}

	if ext := parseWikidataLexemeRef(rel.TargetRef); ext != "" {
		targetLex := sourceLexemeByExternalID[ext]
		if targetLex != nil && targetLex.ID != srcLex.ID {
			id := targetLex.ID
			rel.TargetLexemeID = &id
			return
		}
	}

	candidatesByTerm := targetLookup[srcLex.Language]
	if candidatesByTerm == nil {
		return
	}
	for _, lookupTerm := range relationTargetLookupTerms(rel.TargetTerm) {
		candidates := candidatesByTerm[lookupTerm]
		targetID := chooseTargetLexemeID(srcLex, candidates)
		if targetID != nil {
			rel.TargetLexemeID = targetID
			if strings.TrimSpace(rel.TargetRef) == "" {
				rel.TargetRef = internalLexemeRef(*targetID)
			}
			break
		}
	}
}

func relationTargetLookupTerms(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}

	candidates := make([]string, 0, 4)
	seen := map[string]struct{}{}
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		if _, ok := seen[s]; ok {
			return
		}
		seen[s] = struct{}{}
		candidates = append(candidates, s)
	}

	add(trimmed)
	add(strings.ReplaceAll(trimmed, "_", " "))

	if strings.HasPrefix(trimmed, "synset:") {
		if open := strings.Index(trimmed, "("); open >= 0 {
			if close := strings.LastIndex(trimmed, ")"); close > open+1 {
				add(trimmed[open+1 : close])
			}
		}
	}

	return candidates
}

func deduplicateRelations(relations []*entity.SemanticRelation) []*entity.SemanticRelation {
	if len(relations) <= 1 {
		return relations
	}

	merged := make(map[string]*entity.SemanticRelation, len(relations))
	for _, rel := range relations {
		if rel == nil {
			continue
		}
		targetID := "nil"
		if rel.TargetLexemeID != nil {
			targetID = fmt.Sprintf("%d", *rel.TargetLexemeID)
		}
		// Keep consistent with DB uniqueness while avoiding over-collapse:
		// - Resolved edge: unique by (source_lexeme_id, target_lexeme_id, relation_type)
		// - Unresolved edge: keep target_term dimension to preserve distinct textual neighbors.
		key := fmt.Sprintf("%d|%s|%s",
			rel.SourceLexemeID,
			targetID,
			rel.RelationType,
		)
		if rel.TargetLexemeID == nil {
			key += "|" + strings.ToLower(strings.TrimSpace(rel.TargetRef))
			key += "|" + strings.ToLower(strings.TrimSpace(rel.TargetTerm))
		}
		existing, ok := merged[key]
		if !ok {
			merged[key] = rel
			continue
		}

		if rel.Strength > existing.Strength {
			existing.Strength = rel.Strength
		}
		existing.SenseMapped = existing.SenseMapped || rel.SenseMapped
		if existing.TargetLexemeID == nil && rel.TargetLexemeID != nil {
			existing.TargetLexemeID = rel.TargetLexemeID
		}
		if strings.TrimSpace(existing.TargetRef) == "" && strings.TrimSpace(rel.TargetRef) != "" {
			existing.TargetRef = rel.TargetRef
		}
		// Keep higher-trust provider for merged edge.
		if scoring.SourceProviderTrustRank(rel.Provider) > scoring.SourceProviderTrustRank(existing.Provider) {
			existing.Provider = rel.Provider
		}
		// Keep a stable, non-empty display term.
		if strings.TrimSpace(existing.TargetTerm) == "" && strings.TrimSpace(rel.TargetTerm) != "" {
			existing.TargetTerm = rel.TargetTerm
		}
	}

	out := make([]*entity.SemanticRelation, 0, len(merged))
	for _, rel := range merged {
		out = append(out, rel)
	}
	return out
}

func chooseTargetLexemeID(source *entity.Lexeme, candidates []*repository.LemmaFormInfo) *int64 {
	if source == nil || len(candidates) == 0 {
		return nil
	}

	sourcePOS := source.PartOfSpeech
	for _, c := range candidates {
		if c == nil || c.LexemeID == 0 || c.LexemeID == source.ID {
			continue
		}
		if sourcePOS != entity.PartOfSpeechUnspecified && strings.ToLower(strings.TrimSpace(c.Pos)) == string(sourcePOS) {
			id := c.LexemeID
			return &id
		}
	}

	for _, c := range candidates {
		if c == nil || c.LexemeID == 0 || c.LexemeID == source.ID {
			continue
		}
		id := c.LexemeID
		return &id
	}

	return nil
}

func (p *Persistence) filterExistingUniqueRelations(ctx context.Context, relations []*entity.SemanticRelation) ([]*entity.SemanticRelation, error) {
	if len(relations) == 0 {
		return relations, nil
	}

	sourceIDs := make(map[int64]struct{})
	for _, rel := range relations {
		if rel == nil || rel.SourceLexemeID == 0 || rel.TargetLexemeID == nil {
			continue
		}
		sourceIDs[rel.SourceLexemeID] = struct{}{}
	}
	if len(sourceIDs) == 0 {
		return relations, nil
	}

	existingKeys := make(map[string]struct{})
	for sourceID := range sourceIDs {
		existing, err := p.relationRepo.FindBySourceLexeme(ctx, sourceID)
		if err != nil {
			return nil, err
		}
		for _, rel := range existing {
			key, ok := relationUniqueKey(rel)
			if !ok {
				continue
			}
			existingKeys[key] = struct{}{}
		}
	}

	out := make([]*entity.SemanticRelation, 0, len(relations))
	for _, rel := range relations {
		key, ok := relationUniqueKey(rel)
		if ok {
			if _, exists := existingKeys[key]; exists {
				continue
			}
			existingKeys[key] = struct{}{}
		}
		out = append(out, rel)
	}
	return out, nil
}

func relationUniqueKey(rel *entity.SemanticRelation) (string, bool) {
	if rel == nil || rel.TargetLexemeID == nil || rel.SourceLexemeID == 0 {
		return "", false
	}
	return fmt.Sprintf("%d|%d|%s", rel.SourceLexemeID, *rel.TargetLexemeID, rel.RelationType), true
}

// mapUnmappedContribRelations maps relations without SourceExternalID to available lexemes
// using POS and gloss similarity matching (same logic as GenericSourceProcessor).
func (p *Persistence) mapUnmappedContribRelations(relations []*entity.SemanticRelation, availableLexemes []*entity.Lexeme) {
	if len(relations) == 0 || len(availableLexemes) == 0 {
		return
	}

	// Build POS index
	lexemesByPOS := make(map[entity.PartOfSpeech][]*entity.Lexeme)
	for _, lex := range availableLexemes {
		lexemesByPOS[lex.PartOfSpeech] = append(lexemesByPOS[lex.PartOfSpeech], lex)
	}

	for _, rel := range relations {
		if rel.SourceExternalID != "" {
			continue
		}

		target := matchRelationToLexeme(rel, availableLexemes, lexemesByPOS)
		if target == nil {
			continue
		}

		rel.SourceExternalID = target.ExternalID
	}
}

// matchRelationToLexeme finds the best matching lexeme for a relation using POS and gloss.
func matchRelationToLexeme(rel *entity.SemanticRelation, allLexemes []*entity.Lexeme, lexemesByPOS map[entity.PartOfSpeech][]*entity.Lexeme) *entity.Lexeme {
	// If no POS hint, fall back to first lexeme
	if rel.SourcePOS == "" {
		return allLexemes[0]
	}

	pos := entity.PartOfSpeech(rel.SourcePOS)
	candidates := lexemesByPOS[pos]
	if len(candidates) == 0 {
		// No lexeme with matching POS — skip
		return nil
	}
	if len(candidates) == 1 {
		return candidates[0]
	}

	// Multiple candidates with same POS (homonyms) — use gloss similarity
	if rel.SourceGloss == "" {
		return candidates[0]
	}

	bestLex := candidates[0]
	bestScore := float64(-1)
	for _, lex := range candidates {
		score := lexemeGlossSimilarity(rel.SourceGloss, lex)
		if score > bestScore {
			bestScore = score
			bestLex = lex
		}
	}
	return bestLex
}

// lexemeGlossSimilarity computes the best Jaccard similarity between a source gloss
// and any gloss associated with the lexeme (SenseGloss or individual Senses).
func lexemeGlossSimilarity(sourceGloss string, lex *entity.Lexeme) float64 {
	best := glossJaccard(sourceGloss, lex.SenseGloss)
	for _, s := range lex.Senses {
		if score := glossJaccard(sourceGloss, s.Gloss); score > best {
			best = score
		}
	}
	return best
}

// glossJaccard computes Jaccard similarity on lowercased word tokens.
func glossJaccard(a, b string) float64 {
	tokA := tokenizeGloss(a)
	tokB := tokenizeGloss(b)
	if len(tokA) == 0 || len(tokB) == 0 {
		return 0
	}

	setA := make(map[string]struct{}, len(tokA))
	for _, t := range tokA {
		setA[t] = struct{}{}
	}
	setB := make(map[string]struct{}, len(tokB))
	for _, t := range tokB {
		setB[t] = struct{}{}
	}

	inter := 0
	for t := range setA {
		if _, ok := setB[t]; ok {
			inter++
		}
	}

	union := len(setA)
	for t := range setB {
		if _, ok := setA[t]; !ok {
			union++
		}
	}
	if union == 0 {
		return 0
	}
	return float64(inter) / float64(union)
}

// tokenizeGloss splits a gloss string into lowercase word tokens.
func tokenizeGloss(s string) []string {
	return strings.Fields(strings.ToLower(s))
}

// --- Relation reference helpers ---
func internalLexemeRef(id int64) string {
	if id <= 0 {
		return ""
	}
	return fmt.Sprintf("vocnet://lexeme/%d", id)
}

func parseWikidataLexemeRef(ref string) string {
	const prefix = "wikidata://lexeme/"
	if !strings.HasPrefix(ref, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(ref, prefix))
}
