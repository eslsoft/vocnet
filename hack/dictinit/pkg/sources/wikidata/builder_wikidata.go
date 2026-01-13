package wikidata

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"github.com/eslsoft/vocnet/hack/dictinit/pkg/store"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/util"
	"github.com/eslsoft/vocnet/internal/entity"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

// BuildWikidataLexeme converts a Wikidata lexeme JSON structure to entity structures for import.
func BuildWikidataLexeme(wd WikidataLexeme) (*store.ImportLexemeData, error) {
	lemmaDataList, lemmaVariants, lemmaText := extractLemmaVariants(wd.Lemmas)
	if lemmaText == "" {
		return nil, errors.New("lemma missing")
	}

	posLabel, categories := resolvePOSAndCategories(wd, lemmaText)

	senses := buildSenses(wd.Senses)

	// Check if this lexeme has any useful data
	hasUsefulData := len(senses) > 0 || len(wd.Forms) > 0 || posLabel != ""
	if !hasUsefulData {
		return nil, errors.New("no senses and no forms")
	}

	senseGloss := firstSenseGloss(senses)
	entryType := resolveEntryType(wd.LexicalCategory, categories, lemmaText)

	lexeme := &entity.Lexeme{
		ExternalID:   wd.ID,
		Language:     entity.LanguageEnglish,
		PartOfSpeech: posLabel,
		EntryType:    entryType,
		SenseGloss:   senseGloss,
		Senses:       senses,
		Relations:    extractWikidataRelations(wd),
		Categories:   categories,
		Completeness: calculateCompleteness(senses, wd.Forms),
	}

	forms := buildForms(wd, lemmaText, lemmaVariants, posLabel)

	return &store.ImportLexemeData{
		Lexeme: lexeme,
		Lemmas: attachFormsToPrimaryLemma(lemmaDataList, forms),
	}, nil
}

// mapWikidataFormType converts Wikidata grammatical features to entity form type.
func mapWikidataFormType(features []string) entity.LexemeFormType {
	for _, feature := range features {
		switch feature {
		case "Q146786":
			return entity.LexemeFormTypePlural
		case "Q1194697", "Q442485", "Q1392475":
			return entity.LexemeFormTypePast
		case "Q1230649":
			return entity.LexemeFormTypePastParticiple
		case "Q10345583", "Q1923028":
			return entity.LexemeFormTypePresentParticiple
		case "Q51929447", "Q51929074":
			return entity.LexemeFormTypeThirdPersonSingular
		case "Q14169499":
			return entity.LexemeFormTypeComparative
		case "Q1817208":
			return entity.LexemeFormTypeSuperlative
		case "Q22716":
			return entity.LexemeFormTypeImperative
		case "Q473746":
			return entity.LexemeFormTypeSubjunctive
		}
	}
	return entity.LexemeFormTypeUnspecified
}

func resolvePOSAndCategories(wd WikidataLexeme, lemmaText string) (string, []string) {
	posLabel := mapLexicalCategoryToPOS(wd.LexicalCategory)
	var categories []string
	if len(wd.Senses) > 0 {
		posAndCats := inferPOSAndCategories(wd.Senses)
		categories = appendUnique(categories, posAndCats.Categories...)
		if posLabel == "" {
			posLabel = posAndCats.POS
		}
	}
	if posLabel == "" {
		posLabel = inferPOSFromForms(lemmaText, wd.Forms)
	}
	return posLabel, categories
}

func buildSenses(senses []WikidataSense) []entity.LexemeSense {
	out := make([]entity.LexemeSense, 0, len(senses))
	for _, wdSense := range senses {
		gloss, lang := selectPreferredGloss(wdSense.Glosses)
		if gloss == "" {
			continue
		}
		out = append(out, entity.LexemeSense{
			Language: mapLanguageCodeToEntity(lang),
			Gloss:    gloss,
		})
	}
	return out
}

func selectPreferredGloss(glosses map[string]WikidataValue) (string, string) {
	for _, key := range []string{"en", "en-us", "en-gb"} {
		if value, ok := glosses[key]; ok {
			return value.Value, key
		}
	}
	for langKey, value := range glosses {
		return value.Value, langKey
	}
	return "", ""
}

func firstSenseGloss(senses []entity.LexemeSense) string {
	if len(senses) == 0 {
		return ""
	}
	return senses[0].Gloss
}

func resolveEntryType(lexicalCategory string, categories []string, lemmaText string) entity.LexemeEntryType {
	entryType := mapLexicalCategoryToEntryType(lexicalCategory)
	if entryType != entity.LexemeEntryTypeWord {
		return entryType
	}
	if isIdiomCategory(categories) {
		return entity.LexemeEntryTypeIdiom
	}
	if isPhraseCategory(categories) || strings.Contains(lemmaText, " ") {
		return entity.LexemeEntryTypePhrase
	}
	return entryType
}

func buildForms(wd WikidataLexeme, lemmaText string, lemmaVariants map[string]struct{}, posLabel string) []*entity.LemmaForm {
	formMap := make(map[string]*entity.LemmaForm)
	for _, wdForm := range wd.Forms {
		text := selectPreferredRepresentation(wdForm.Representations)
		if text == "" {
			continue
		}

		textLower := strings.ToLower(strings.TrimSpace(text))
		formType := resolveFormType(lemmaText, text, textLower, posLabel, lemmaVariants, wdForm, wd.ID)
		irregular := util.IsIrregularForm(lemmaText, text, util.EntityFormTypeToProto(formType))

		form := &entity.LemmaForm{
			Surface:     text,
			Normalized:  textLower,
			FormType:    formType,
			IsIrregular: irregular,
		}

		if existing, ok := formMap[textLower]; ok {
			if existing.FormType == entity.LexemeFormTypeUnspecified && formType != entity.LexemeFormTypeUnspecified {
				formMap[textLower] = form
			} else if irregular && !existing.IsIrregular {
				formMap[textLower] = form
			}
		} else {
			formMap[textLower] = form
		}
	}

	forms := make([]*entity.LemmaForm, 0, len(formMap))
	for _, form := range formMap {
		forms = append(forms, form)
	}
	return forms
}

func selectPreferredRepresentation(representations map[string]WikidataValue) string {
	for _, key := range []string{"en", "en-us", "en-gb"} {
		if value, ok := representations[key]; ok {
			return value.Value
		}
	}
	for _, value := range representations {
		return value.Value
	}
	return ""
}

func resolveFormType(lemmaText, text, textLower, posLabel string, lemmaVariants map[string]struct{}, wdForm WikidataForm, lexemeID string) entity.LexemeFormType {
	formType := mapWikidataFormType(wdForm.GrammaticalFeatures)
	if formType == entity.LexemeFormTypeUnspecified {
		if strings.EqualFold(textLower, strings.ToLower(strings.TrimSpace(lemmaText))) {
			formType = entity.LexemeFormTypeLemma
		}
	}
	if formType == entity.LexemeFormTypeUnspecified {
		if _, ok := lemmaVariants[textLower]; ok {
			formType = entity.LexemeFormTypeLemma
		}
	}
	if formType == entity.LexemeFormTypeUnspecified {
		inferred := inferFormTypeFromSurface(lemmaText, text, posLabel)
		if inferred == entity.LexemeFormTypeUnspecified && posLabel == "" {
			inferred = inferFormTypeFromSurfaceLoose(lemmaText, text)
		}
		if inferred != entity.LexemeFormTypeUnspecified {
			if len(wdForm.GrammaticalFeatures) == 0 && shouldLogInference(inferred) {
				util.Info("[wikidata][infer-low] id=%s lemma=%q form=%q pos=%q inferred=%s",
					lexemeID, lemmaText, text, posLabel, inferred)
			}
			formType = inferred
		}
	}
	return formType
}

func extractLemmaVariants(lemmas map[string]WikidataValue) ([]*store.ImportLemmaData, map[string]struct{}, string) {
	if len(lemmas) == 0 {
		return nil, nil, ""
	}

	selected := selectLemmaCodes(lemmas)
	primaryCode := pickPrimaryLemmaCode(selected)

	out := make([]*store.ImportLemmaData, 0, len(lemmas))
	seen := make(map[string]struct{})
	variants := make(map[string]struct{})
	primaryText := ""

	for code, value := range lemmas {
		if _, ok := selected[code]; !ok {
			continue
		}
		text := strings.TrimSpace(value.Value)
		if text == "" {
			continue
		}
		normalized := strings.ToLower(text)
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		variant := mapLemmaVariantFromCode(code)
		isPrimary := code == primaryCode
		if isPrimary {
			primaryText = text
		}
		out = append(out, &store.ImportLemmaData{
			Surface:    text,
			Normalized: normalized,
			Variant:    variant,
			IsPrimary:  isPrimary,
		})
		variants[normalized] = struct{}{}
	}

	if primaryText == "" && len(out) > 0 {
		out[0].IsPrimary = true
		primaryText = out[0].Surface
	}

	return out, variants, primaryText
}

func selectLemmaCodes(lemmas map[string]WikidataValue) map[string]struct{} {
	selected := make(map[string]struct{})
	preferred := []string{"en", "en-us", "en-gb", "en-au", "en-ca", "en-nz", "en-in", "en-jm"}

	for _, code := range preferred {
		if _, ok := lemmas[code]; ok {
			selected[code] = struct{}{}
		}
	}
	if len(selected) > 0 {
		return selected
	}

	for code := range lemmas {
		lower := strings.ToLower(code)
		if strings.HasPrefix(lower, "en-") && !strings.HasPrefix(lower, "en-x-") {
			selected[code] = struct{}{}
		}
	}
	if len(selected) > 0 {
		return selected
	}

	for code := range lemmas {
		selected[code] = struct{}{}
	}
	return selected
}

func pickPrimaryLemmaCode(selected map[string]struct{}) string {
	if len(selected) == 0 {
		return ""
	}
	preferred := []string{"en", "en-us", "en-gb", "en-au", "en-ca", "en-nz", "en-in", "en-jm"}
	for _, code := range preferred {
		if _, ok := selected[code]; ok {
			return code
		}
	}
	codes := make([]string, 0, len(selected))
	for code := range selected {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	return codes[0]
}

func mapLemmaVariantFromCode(code string) string {
	lower := strings.ToLower(code)
	if strings.HasPrefix(lower, "en-x-") {
		return ""
	}
	switch lower {
	case "en-us":
		return "US"
	case "en-gb":
		return "UK"
	case "en-au":
		return "AU"
	case "en-ca":
		return "CA"
	case "en-nz":
		return "NZ"
	case "en-in":
		return "IN"
	case "en-jm":
		return "JM"
	default:
		if strings.EqualFold(code, "en") {
			return ""
		}
		return strings.ToUpper(code)
	}
}

func attachFormsToPrimaryLemma(lemmas []*store.ImportLemmaData, forms []*entity.LemmaForm) []*store.ImportLemmaData {
	if len(lemmas) == 0 {
		return lemmas
	}
	for _, lemma := range lemmas {
		if lemma.IsPrimary {
			lemma.Forms = forms
			return lemmas
		}
	}
	lemmas[0].IsPrimary = true
	lemmas[0].Forms = forms
	return lemmas
}

func inferPOSFromForms(lemma string, forms []WikidataForm) string {
	lemmaLower := strings.ToLower(strings.TrimSpace(lemma))
	hasVerb := false
	hasAdj := false
	hasNoun := false

	for _, form := range forms {
		switch mapWikidataFormType(form.GrammaticalFeatures) {
		case entity.LexemeFormTypePast,
			entity.LexemeFormTypePastParticiple,
			entity.LexemeFormTypePresentParticiple,
			entity.LexemeFormTypeThirdPersonSingular,
			entity.LexemeFormTypeImperative,
			entity.LexemeFormTypeSubjunctive:
			hasVerb = true
		case entity.LexemeFormTypePlural:
			hasNoun = true
		case entity.LexemeFormTypeComparative,
			entity.LexemeFormTypeSuperlative:
			hasAdj = true
		}

		if hasVerb || hasAdj || hasNoun {
			continue
		}

		text := extractWikidataFormText(form)
		formLower := strings.ToLower(strings.TrimSpace(text))
		if formLower == "" || formLower == lemmaLower || strings.Contains(formLower, " ") {
			continue
		}
		if !isAlphaLikeForm(text) || isAllCapsAlpha(text) {
			continue
		}

		switch {
		case strings.HasSuffix(formLower, "ing"),
			strings.HasSuffix(formLower, "ed"),
			strings.HasSuffix(formLower, "en"):
			hasVerb = true
		case strings.HasSuffix(formLower, "est"),
			strings.HasSuffix(formLower, "er"):
			hasAdj = true
		case strings.HasSuffix(formLower, "ies"),
			strings.HasSuffix(formLower, "es"),
			strings.HasSuffix(formLower, "s"):
			hasNoun = true
		}
	}

	switch {
	case hasVerb:
		return "v."
	case hasAdj:
		return "adj."
	case hasNoun:
		return "n."
	default:
		return ""
	}
}

func extractWikidataFormText(form WikidataForm) string {
	for _, key := range []string{"en", "en-us", "en-gb"} {
		if value, ok := form.Representations[key]; ok {
			return value.Value
		}
	}
	for _, value := range form.Representations {
		return value.Value
	}
	return ""
}

func extractWikidataRelations(wd WikidataLexeme) []entity.LexemeRelation {
	propertyToRelation := map[string]dictv1.RelationType{
		"P5973": dictv1.RelationType_RELATION_TYPE_SYNONYM,
		"P5974": dictv1.RelationType_RELATION_TYPE_ANTONYM,
		"P5975": dictv1.RelationType_RELATION_TYPE_HYPERNYM,
	}

	relations := make([]entity.LexemeRelation, 0)
	seen := make(map[string]struct{})

	addRelation := func(target string, relType dictv1.RelationType) {
		if target == "" || target == wd.ID {
			return
		}
		key := fmt.Sprintf("%s:%s:%d", wd.ID, target, relType)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		relations = append(relations, entity.LexemeRelation{
			LexemeID:       wd.ID,
			TargetLexemeID: target,
			RelationType:   int32(relType),
		})
	}

	for property, claims := range wd.Claims {
		relType, ok := propertyToRelation[property]
		if !ok {
			continue
		}
		for _, claim := range claims {
			if target := extractWikidataRelationTarget(claim); target != "" {
				addRelation(target, relType)
			}
		}
	}

	for _, sense := range wd.Senses {
		for property, claims := range sense.Claims {
			relType, ok := propertyToRelation[property]
			if !ok {
				continue
			}
			for _, claim := range claims {
				if target := extractWikidataRelationTarget(claim); target != "" {
					addRelation(target, relType)
				}
			}
		}
	}

	return relations
}

func extractWikidataRelationTarget(claim WikidataClaim) string {
	value := claim.MainSnak.DataValue.Value
	switch typed := value.(type) {
	case string:
		return normalizeWikidataLexemeID(typed)
	case map[string]interface{}:
		if id, ok := typed["id"].(string); ok {
			return normalizeWikidataLexemeID(id)
		}
		if entityType, ok := typed["entity-type"].(string); ok && (entityType == "lexeme" || entityType == "sense") {
			if numeric, ok := typed["numeric-id"].(float64); ok {
				return fmt.Sprintf("L%d", int(numeric))
			}
		}
	}
	return ""
}

func normalizeWikidataLexemeID(id string) string {
	id = strings.TrimSpace(id)
	if id == "" || !strings.HasPrefix(id, "L") {
		return ""
	}
	if idx := strings.Index(id, "-"); idx >= 0 {
		id = id[:idx]
	}
	return id
}

func inferFormTypeFromSurface(lemma, form, posLabel string) entity.LexemeFormType {
	lemmaLower := strings.ToLower(strings.TrimSpace(lemma))
	formLower := strings.ToLower(strings.TrimSpace(form))

	if lemmaLower == "" || formLower == "" {
		return entity.LexemeFormTypeUnspecified
	}
	if !isAlphaLikeForm(form) || isAllCapsAlpha(form) {
		return entity.LexemeFormTypeUnspecified
	}
	if lemmaLower == formLower {
		return entity.LexemeFormTypeLemma
	}
	if strings.Contains(formLower, " ") {
		return entity.LexemeFormTypeUnspecified
	}
	if hasPossessiveSuffix(formLower) {
		return entity.LexemeFormTypeUnspecified
	}

	if (posLabel == "v." || posLabel == "pron.") &&
		(strings.ContainsRune(formLower, '\'') || strings.ContainsRune(formLower, '\u2019')) {
		return entity.LexemeFormTypeShortForm
	}

	switch posLabel {
	case "v.":
		switch {
		case strings.HasSuffix(formLower, "ing"):
			return entity.LexemeFormTypePresentParticiple
		case strings.HasSuffix(formLower, "ed"):
			return entity.LexemeFormTypePast
		case strings.HasSuffix(formLower, "en"):
			return entity.LexemeFormTypePastParticiple
		case strings.HasSuffix(formLower, "ies"), strings.HasSuffix(formLower, "es"), strings.HasSuffix(formLower, "s"):
			return entity.LexemeFormTypeThirdPersonSingular
		}
	case "n.":
		switch {
		case strings.HasSuffix(formLower, "ies"), strings.HasSuffix(formLower, "es"), strings.HasSuffix(formLower, "s"):
			return entity.LexemeFormTypePlural
		}
	case "adj.":
		switch {
		case strings.HasSuffix(formLower, "est"):
			return entity.LexemeFormTypeSuperlative
		case strings.HasSuffix(formLower, "er"):
			return entity.LexemeFormTypeComparative
		}
	}

	return entity.LexemeFormTypeUnspecified
}

func inferFormTypeFromSurfaceLoose(lemma, form string) entity.LexemeFormType {
	lemmaLower := strings.ToLower(strings.TrimSpace(lemma))
	formLower := strings.ToLower(strings.TrimSpace(form))

	if lemmaLower == "" || formLower == "" {
		return entity.LexemeFormTypeUnspecified
	}
	if !isAlphaLikeForm(form) || isAllCapsAlpha(form) {
		return entity.LexemeFormTypeUnspecified
	}
	if lemmaLower == formLower {
		return entity.LexemeFormTypeLemma
	}
	if strings.Contains(formLower, " ") || hasPossessiveSuffix(formLower) {
		return entity.LexemeFormTypeUnspecified
	}

	switch {
	case strings.HasSuffix(formLower, "ing"):
		return entity.LexemeFormTypePresentParticiple
	case strings.HasSuffix(formLower, "ed"):
		return entity.LexemeFormTypePast
	case strings.HasSuffix(formLower, "en"):
		return entity.LexemeFormTypePastParticiple
	case strings.HasSuffix(formLower, "est"):
		return entity.LexemeFormTypeSuperlative
	case strings.HasSuffix(formLower, "er"):
		return entity.LexemeFormTypeComparative
	case strings.HasSuffix(formLower, "ies"), strings.HasSuffix(formLower, "es"), strings.HasSuffix(formLower, "s"):
		return entity.LexemeFormTypePlural
	default:
		return entity.LexemeFormTypeUnspecified
	}
}

func shouldLogInference(inferred entity.LexemeFormType) bool {
	switch inferred {
	case entity.LexemeFormTypePlural,
		entity.LexemeFormTypeThirdPersonSingular,
		entity.LexemeFormTypeComparative,
		entity.LexemeFormTypeSuperlative,
		entity.LexemeFormTypePastParticiple,
		entity.LexemeFormTypeShortForm:
		return true
	default:
		return false
	}
}

func hasPossessiveSuffix(formLower string) bool {
	return strings.HasSuffix(formLower, "'s") ||
		strings.HasSuffix(formLower, "’s") ||
		strings.HasSuffix(formLower, "s'") ||
		strings.HasSuffix(formLower, "s’")
}

func isAlphaLikeForm(form string) bool {
	for _, r := range form {
		if unicode.IsLetter(r) || r == '\'' || r == '\u2019' || r == '-' {
			continue
		}
		return false
	}
	return true
}

func isAllCapsAlpha(form string) bool {
	letterCount := 0
	for _, r := range form {
		if !unicode.IsLetter(r) {
			return false
		}
		if unicode.IsLower(r) {
			return false
		}
		letterCount++
	}
	return letterCount >= 2
}

// mapLanguageCodeToEntity converts language code to entity.Language.
func mapLanguageCodeToEntity(code string) entity.Language {
	switch code {
	case "en", "en-us", "en-gb":
		return entity.LanguageEnglish
	case "zh", "zh-cn", "zh-hans", "zh-hant":
		return entity.LanguageChinese
	default:
		return entity.LanguageEnglish
	}
}

// calculateCompleteness calculates a completeness score (0-100) based on available data.
func calculateCompleteness(senses []entity.LexemeSense, forms []WikidataForm) int32 {
	score := int32(0)

	// Senses contribute up to 60 points
	if len(senses) > 0 {
		score += 40
		if len(senses) >= 2 {
			score += 10
		}
		if len(senses) >= 3 {
			score += 10
		}
	}

	// Forms contribute up to 40 points
	if len(forms) > 0 {
		score += 20
		if len(forms) >= 3 {
			score += 10
		}
		if len(forms) >= 5 {
			score += 10
		}
	}

	return score
}

// mapLexicalCategoryToEntryType maps Wikidata lexical category to entity.LexemeEntryType.
func mapLexicalCategoryToEntryType(category string) entity.LexemeEntryType {
	switch category {
	case "Q11235372": // phrase
		return entity.LexemeEntryTypePhrase
	case "Q184511": // idiom
		return entity.LexemeEntryTypeIdiom
	default:
		return entity.LexemeEntryTypeWord
	}
}

// isPhraseCategory checks if any category indicates a phrase.
func isPhraseCategory(categories []string) bool {
	for _, cat := range categories {
		if cat == "attr:phrase" || cat == "phrase" || cat == "saying" {
			return true
		}
	}
	return false
}

// isIdiomCategory checks if any category indicates an idiom.
func isIdiomCategory(categories []string) bool {
	for _, cat := range categories {
		if cat == "attr:idiom" || cat == "idiom" {
			return true
		}
	}
	return false
}
