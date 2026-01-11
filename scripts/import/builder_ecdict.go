package main

import (
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
)

// BuildECDictLexeme converts ECDICT data to entity structures for import.
func BuildECDictLexeme(word string, enrichment *ecdictEnrichment) (*ImportLexemeData, error) {
	if word == "" {
		return nil, nil
	}

	// Parse exchange to get forms
	var lemmaText string
	var forms []*entity.LemmaForm
	if enrichment.exchange != "" {
		lemmaText, forms = parseExchangeToEntity(word, enrichment.exchange)
	}

	// If no lemma from exchange, use word itself
	if lemmaText == "" {
		lemmaText = word
	}

	// Determine POS from senses
	pos := "n." // default
	if len(enrichment.senses) > 0 {
		pos = enrichment.senses[0].partOfSpeech
		if pos == "" {
			pos = "n."
		}
	}

	// Build senses
	senses := make([]entity.LexemeSense, 0, len(enrichment.senses))
	for _, sense := range enrichment.senses {
		senses = append(senses, entity.LexemeSense{
			Language: mapCommonLanguageToEntity(sense.language),
			Gloss:    sense.gloss,
		})
	}

	// Build phonetics for lemma
	phonetics := make([]entity.Phonetic, 0, len(enrichment.phonetics))
	for _, p := range enrichment.phonetics {
		phonetics = append(phonetics, entity.Phonetic{
			IPA:     p.GetIpa(),
			Dialect: p.GetDialect(),
		})
	}

	// Build SenseGloss (first sense gloss for quick preview)
	senseGloss := ""
	if len(senses) > 0 {
		senseGloss = senses[0].Gloss
	}

	// Build frequencies from BNC, FRQ, and Collins
	frequencies := buildFrequencies(enrichment.bnc, enrichment.frq, enrichment.collins)

	// Determine entry type (WORD vs PHRASE) - simple: check for spaces
	entryType := determineEntryType(word)

	// Build categories with additional metadata (without collins, it's in frequencies now)
	categories := buildCategories(enrichment.categories, enrichment.oxford)

	// Build lexeme
	lexeme := &entity.Lexeme{
		ExternalID:   "TL-ECDICT-" + word, // Temporary ID for ECDICT words
		Language:     entity.LanguageEnglish,
		PartOfSpeech: pos,
		EntryType:    entryType,
		Frequencies:  frequencies,
		SenseGloss:   senseGloss,
		Senses:       senses,
		Categories:   categories,
		Completeness: calculateCompletenessECDict(senses, forms, phonetics),
	}

	// Attach phonetics to lemma forms
	lemmaForms := make([]*entity.LemmaForm, 0, len(forms)+1)

	// Deduplicate phonetics to avoid database duplicates
	phonetics = deduplicatePhonetics(phonetics)

	// Determine which form should receive the phonetics
	// If enriching an inflected form (e.g. "ran"), phonetics belong to "ran", not lemma "run"
	phoneticsTarget := word

	// Add the lemma itself as a form
	lemmaPhonetics := []entity.Phonetic(nil)
	if strings.EqualFold(lemmaText, phoneticsTarget) {
		lemmaPhonetics = phonetics
	}

	if lemmaText != "" {
		lemmaForms = append(lemmaForms, &entity.LemmaForm{
			Surface:     lemmaText,
			Normalized:  strings.ToLower(lemmaText),
			FormType:    entity.LexemeFormTypeLemma,
			IsIrregular: false,
			Phonetics:   lemmaPhonetics,
		})
	}

	// Add other forms
	targetFound := strings.EqualFold(lemmaText, phoneticsTarget)

	for _, form := range forms {
		// Skip if it's another lemma form (prevent duplicates)
		if form.FormType == entity.LexemeFormTypeLemma {
			continue
		}

		// Attach phonetics if this form matches the target
		if strings.EqualFold(form.Surface, phoneticsTarget) {
			form.Phonetics = phonetics
			targetFound = true
		}

		lemmaForms = append(lemmaForms, form)
	}

	// If the word being enriched wasn't found in the forms list (and isn't the lemma),
	// add it as a specific form to ensure phonetics are preserved.
	if !targetFound && len(phonetics) > 0 {
		lemmaForms = append(lemmaForms, &entity.LemmaForm{
			Surface:     phoneticsTarget,
			Normalized:  strings.ToLower(phoneticsTarget),
			FormType:    entity.LexemeFormTypeUnspecified, // Type unknown from ECDICT
			IsIrregular: false,
			Phonetics:   phonetics,
		})
	}

	// Build lemma data
	lemmaData := &ImportLemmaData{
		Surface:    lemmaText,
		Normalized: strings.ToLower(lemmaText),
		IsPrimary:  true,
		Forms:      lemmaForms,
	}

	return &ImportLexemeData{
		Lexeme: lexeme,
		Lemmas: []*ImportLemmaData{lemmaData},
	}, nil
}

// parseExchangeToEntity parses ECDICT exchange string to entity forms.
func parseExchangeToEntity(word, exchange string) (string, []*entity.LemmaForm) {
	parts := strings.Split(exchange, "/")
	forms := make([]*entity.LemmaForm, 0, len(parts))
	lemma := ""

	for _, part := range parts {
		if part == "" {
			continue
		}

		idx := strings.Index(part, ":")
		if idx == -1 {
			continue
		}

		typeCode := part[:idx]
		formText := part[idx+1:]

		if typeCode == "0" {
			// This is the lemma reference
			lemma = formText
			continue
		}

		formType := mapECDictFormType(typeCode)
		if formType == entity.LexemeFormTypeUnspecified {
			continue
		}

		// Detect if irregular
		irregular := isIrregularForm(word, formText, entityFormTypeToProto(formType))

		forms = append(forms, &entity.LemmaForm{
			Surface:     formText,
			Normalized:  strings.ToLower(formText),
			FormType:    formType,
			IsIrregular: irregular,
		})
	}

	return lemma, forms
}

// mapECDictFormType maps ECDICT form type codes to entity.LexemeFormType.
func mapECDictFormType(code string) entity.LexemeFormType {
	switch code {
	case "p":
		return entity.LexemeFormTypePast
	case "d":
		return entity.LexemeFormTypePastParticiple
	case "i":
		return entity.LexemeFormTypePresentParticiple
	case "3":
		return entity.LexemeFormTypeThirdPersonSingular
	case "r":
		return entity.LexemeFormTypeComparative
	case "t":
		return entity.LexemeFormTypeSuperlative
	case "s":
		return entity.LexemeFormTypePlural
	default:
		return entity.LexemeFormTypeUnspecified
	}
}

// mapCommonLanguageToEntity converts commonv1.Language to entity.Language.
func mapCommonLanguageToEntity(lang commonv1.Language) entity.Language {
	switch lang {
	case commonv1.Language_LANGUAGE_ENGLISH:
		return entity.LanguageEnglish
	case commonv1.Language_LANGUAGE_CHINESE:
		return entity.LanguageChinese
	default:
		// ECDICT definitions are typically in Chinese if not specified
		return entity.LanguageChinese
	}
}

// calculateCompletenessECDict calculates completeness score for ECDICT entries.
func calculateCompletenessECDict(senses []entity.LexemeSense, forms []*entity.LemmaForm, phonetics []entity.Phonetic) int32 {
	score := int32(0)

	// Senses contribute up to 40 points
	if len(senses) > 0 {
		score += 30
		if len(senses) >= 2 {
			score += 10
		}
	}

	// Forms contribute up to 30 points
	if len(forms) > 0 {
		score += 15
		if len(forms) >= 3 {
			score += 15
		}
	}

	// Phonetics contribute up to 30 points
	if len(phonetics) > 0 {
		score += 20
		if len(phonetics) >= 2 {
			score += 10
		}
	}

	return score
}

// buildFrequencies constructs Frequency array from BNC, FRQ, and Collins data.
func buildFrequencies(bnc, frq int64, collins int) []entity.Frequency {
	var frequencies []entity.Frequency

	// Collins star rating (1-5) - usage frequency indicator
	// 5 stars = most frequent, 1 star = less frequent
	if collins > 0 && collins <= 5 {
		frequencies = append(frequencies, entity.Frequency{
			Corpus: "Collins",
			Count:  int64(collins),
		})
	}

	// BNC (British National Corpus) - historical frequency rank
	if bnc > 0 {
		frequencies = append(frequencies, entity.Frequency{
			Corpus: "BNC",
			Count:  bnc,
		})
	}

	// FRQ (Contemporary Corpus) - modern frequency rank
	if frq > 0 {
		frequencies = append(frequencies, entity.Frequency{
			Corpus: "COCA", // Contemporary Corpus of American English
			Count:  frq,
		})
	}

	return frequencies
}

// determineEntryType determines if this is a WORD or PHRASE.
// A phrase contains spaces, a word doesn't.
func determineEntryType(word string) entity.LexemeEntryType {
	// If the word contains a space, it's a phrase
	if strings.Contains(word, " ") {
		return entity.LexemeEntryTypePhrase
	}
	return entity.LexemeEntryTypeWord
}

// buildCategories builds the categories array with additional metadata.
func buildCategories(baseCategories []string, oxford bool) []string {
	categories := make([]string, 0, len(baseCategories)+1)

	// Add base categories from tags
	categories = append(categories, baseCategories...)

	// Add Oxford 3000 marker
	if oxford {
		categories = append(categories, "oxford:3000")
	}

	return categories
}

// deduplicatePhonetics removes duplicate phonetics based on IPA + Dialect.
func deduplicatePhonetics(phonetics []entity.Phonetic) []entity.Phonetic {
	if len(phonetics) <= 1 {
		return phonetics
	}

	seen := make(map[string]struct{})
	result := make([]entity.Phonetic, 0, len(phonetics))

	for _, p := range phonetics {
		// Normalize key to avoid subtle differences
		key := strings.TrimSpace(p.IPA) + "|" + strings.ToLower(strings.TrimSpace(p.Dialect))
		if _, exists := seen[key]; !exists {
			seen[key] = struct{}{}
			result = append(result, p)
		}
	}

	return result
}
