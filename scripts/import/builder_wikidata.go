package main

import (
	"errors"
	"strings"
	"unicode"

	"github.com/eslsoft/vocnet/internal/entity"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

// BuildWikidataLexeme converts a Wikidata lexeme JSON structure to entity structures for import.
func BuildWikidataLexeme(wd WikidataLexeme) (*ImportLexemeData, error) {
	lemmaText := extractLemma(wd.Lemmas)
	if lemmaText == "" {
		return nil, errors.New("lemma missing")
	}

	// Extract POS and categories from glosses if needed
	posLabel := mapLexicalCategoryToPOS(wd.LexicalCategory)
	var categories []string
	if posLabel == "" && len(wd.Senses) > 0 {
		posAndCats := inferPOSAndCategories(wd.Senses)
		posLabel = posAndCats.POS
		categories = posAndCats.Categories
	}

	// Build senses
	senses := make([]entity.LexemeSense, 0, len(wd.Senses))
	for _, wdSense := range wd.Senses {
		var gloss string
		var lang string
		for _, key := range []string{"en", "en-us", "en-gb"} {
			if value, ok := wdSense.Glosses[key]; ok {
				gloss = value.Value
				lang = key
				break
			}
		}
		if gloss == "" {
			for langKey, value := range wdSense.Glosses {
				gloss = value.Value
				lang = langKey
				break
			}
		}
		if gloss != "" {
			senses = append(senses, entity.LexemeSense{
				Language: mapLanguageCodeToEntity(lang),
				Gloss:    gloss,
			})
		}
	}

	// Check if this lexeme has any useful data
	hasUsefulData := len(senses) > 0 || len(wd.Forms) > 0 || posLabel != ""
	if !hasUsefulData {
		return nil, errors.New("no senses and no forms")
	}

	// Build SenseGloss (first sense gloss for quick preview)
	senseGloss := ""
	if len(senses) > 0 {
		senseGloss = senses[0].Gloss
	}

	// Determine entry type
	entryType := mapLexicalCategoryToEntryType(wd.LexicalCategory)
	if entryType == entity.LexemeEntryTypeWord {
		if isIdiomCategory(categories) {
			entryType = entity.LexemeEntryTypeIdiom
		} else if isPhraseCategory(categories) || strings.Contains(lemmaText, " ") {
			entryType = entity.LexemeEntryTypePhrase
		}
	}

	// Build lexeme
	lexeme := &entity.Lexeme{
		ExternalID:   wd.ID,
		Language:     entity.LanguageEnglish,
		PartOfSpeech: posLabel,
		EntryType:    entryType,
		SenseGloss:   senseGloss,
		Senses:       senses,
		Categories:   categories,
		Completeness: calculateCompleteness(senses, wd.Forms),
	}

	// Build forms
	formMap := make(map[string]*entity.LemmaForm)
	for _, wdForm := range wd.Forms {
		text := ""
		for _, key := range []string{"en", "en-us", "en-gb"} {
			if value, ok := wdForm.Representations[key]; ok {
				text = value.Value
				break
			}
		}
		if text == "" {
			for _, value := range wdForm.Representations {
				text = value.Value
				break
			}
		}
		if text == "" {
			continue
		}

		// Skip if same as lemma (case-insensitive)
		textLower := strings.ToLower(strings.TrimSpace(text))
		// Removed lemma exclusion to allow lemma to be present in forms


		formType := mapWikidataFormType(wdForm.GrammaticalFeatures)
		if formType == entity.LexemeFormTypeUnspecified {
			inferred := inferFormTypeFromSurface(lemmaText, text, posLabel)
			if inferred != entity.LexemeFormTypeUnspecified {
				if len(wdForm.GrammaticalFeatures) == 0 && shouldLogInference(inferred) {
					Info("[wikidata][infer-low] id=%s lemma=%q form=%q pos=%q inferred=%s",
						wd.ID, lemmaText, text, posLabel, inferred)
				}
				formType = inferred
			}
		}
		irregular := isIrregularForm(lemmaText, text, entityFormTypeToProto(formType))

		form := &entity.LemmaForm{
			Surface:     text,
			Normalized:  textLower,
			FormType:    formType,
			IsIrregular: irregular,
		}

		// Deduplicate forms by normalized text
		if existing, ok := formMap[textLower]; ok {
			// Prefer forms with specific type over unspecified
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

	// Build lemma data
	lemmaData := &ImportLemmaData{
		Surface:    lemmaText,
		Normalized: strings.ToLower(lemmaText),
		IsPrimary:  true,
		Forms:      forms,
	}

	return &ImportLexemeData{
		Lexeme: lexeme,
		Lemmas: []*ImportLemmaData{lemmaData},
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

// entityFormTypeToProto converts entity.LexemeFormType to dictv1.FormType for use with legacy functions.
func entityFormTypeToProto(formType entity.LexemeFormType) dictv1.FormType {
	switch formType {
	case entity.LexemeFormTypePlural:
		return dictv1.FormType_FORM_TYPE_PLURAL
	case entity.LexemeFormTypePast:
		return dictv1.FormType_FORM_TYPE_PAST
	case entity.LexemeFormTypePastParticiple:
		return dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE
	case entity.LexemeFormTypePresentParticiple:
		return dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE
	case entity.LexemeFormTypeThirdPersonSingular:
		return dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR
	case entity.LexemeFormTypeComparative:
		return dictv1.FormType_FORM_TYPE_COMPARATIVE
	case entity.LexemeFormTypeSuperlative:
		return dictv1.FormType_FORM_TYPE_SUPERLATIVE
	case entity.LexemeFormTypeImperative:
		return dictv1.FormType_FORM_TYPE_IMPERATIVE
	case entity.LexemeFormTypeSubjunctive:
		return dictv1.FormType_FORM_TYPE_SUBJUNCTIVE
	case entity.LexemeFormTypeGerund:
		return dictv1.FormType_FORM_TYPE_GERUND
	case entity.LexemeFormTypeShortForm:
		return dictv1.FormType_FORM_TYPE_SHORT_FORM
	case entity.LexemeFormTypeLemma:
		return dictv1.FormType_FORM_TYPE_LEMMA
	default:
		return dictv1.FormType_FORM_TYPE_UNSPECIFIED
	}
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
