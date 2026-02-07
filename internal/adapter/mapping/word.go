package mapping

import (
	"sort"
	"strings"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/eslsoft/vocnet/internal/entity"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

// ToPbWord converts a word entry into the public proto response.
func ToPbWord(entry *entity.WordEntry) *dictv1.Word {
	if entry == nil || entry.Lemma == nil {
		return nil
	}

	// Check if the queried term matches the lemma surface (is queried lemma)
	queriedForm := findFormByText(entry.Lemma.Forms, entry.QueriedTerm)
	isQueriedLemma := queriedForm != nil && queriedForm.FormType == entity.LexemeFormTypeLemma

	if isQueriedLemma {
		return buildLemmaView(entry, queriedForm)
	}
	return buildFormView(entry, queriedForm)
}

func buildLemmaView(entry *entity.WordEntry, queriedForm *entity.LemmaForm) *dictv1.Word {
	var lemmaPhonetics []entity.Phonetic
	if queriedForm != nil {
		lemmaPhonetics = queriedForm.Phonetics
	}

	// Use form surface if available (preserves case), otherwise queried term or lemma surface
	displayTerm := entry.QueriedTerm
	if queriedForm != nil {
		displayTerm = queriedForm.Surface
	} else if displayTerm == "" {
		displayTerm = entry.Lemma.Surface
	}

	// Get language and categories from the first lexeme (they should all be the same language)
	var language entity.Language
	var categories []string
	var completeness int32
	if len(entry.Lexemies) > 0 {
		language = entry.Lexemies[0].Language
		// Aggregate categories from all lexemes
		categorySet := make(map[string]bool)
		var completenessSum int64
		for _, lex := range entry.Lexemies {
			for _, cat := range lex.Categories {
				categorySet[cat] = true
			}
			completenessSum += int64(lex.Completeness)
		}
		categories = make([]string, 0, len(categorySet))
		for cat := range categorySet {
			categories = append(categories, cat)
		}
		if len(entry.Lexemies) > 0 {
			completeness = int32(completenessSum / int64(len(entry.Lexemies)))
		}
	}

	word := &dictv1.Word{
		Id:           entry.Lemma.ID,
		Term:         displayTerm,
		TermType:     dictv1.FormType_FORM_TYPE_LEMMA,
		Lemma:        nil,
		Language:     ToPbLanguage(language),
		Phonetics:    mapPhonetics(lemmaPhonetics),
		Meanings:     aggregateMeanings(entry.Lexemies),
		RelatedForms: buildRelatedForms(entry.Lemma.Forms, queriedForm),
		Syllables:    entry.Lemma.Syllables,
		Categories:   categories,
		Irregular:    false,
		Completeness: completeness,
	}
	setTimestampsFromLexemes(word, entry.Lexemies)
	return word
}

func buildFormView(entry *entity.WordEntry, queriedForm *entity.LemmaForm) *dictv1.Word {
	var phonetics []entity.Phonetic
	var formType entity.LexemeFormType
	var isIrregular bool

	if queriedForm != nil {
		phonetics = queriedForm.Phonetics
		formType = queriedForm.FormType
		isIrregular = queriedForm.IsIrregular
	}

	lemmaText := entry.Lemma.Surface

	// Get language, categories, and completeness from lexemes
	var language entity.Language
	var categories []string
	var completeness int32
	if len(entry.Lexemies) > 0 {
		language = entry.Lexemies[0].Language
		categorySet := make(map[string]bool)
		var completenessSum int64
		for _, lex := range entry.Lexemies {
			for _, cat := range lex.Categories {
				categorySet[cat] = true
			}
			completenessSum += int64(lex.Completeness)
		}
		categories = make([]string, 0, len(categorySet))
		for cat := range categorySet {
			categories = append(categories, cat)
		}
		if len(entry.Lexemies) > 0 {
			completeness = int32(completenessSum / int64(len(entry.Lexemies)))
		}
	}

	term := entry.QueriedTerm
	if queriedForm != nil {
		term = queriedForm.Surface
	}

	word := &dictv1.Word{
		Id:           entry.Lemma.ID,
		Term:         term,
		TermType:     toPbFormType(formType),
		Lemma:        &lemmaText,
		Language:     ToPbLanguage(language),
		Phonetics:    mapPhonetics(phonetics),
		Meanings:     aggregateMeanings(entry.Lexemies),
		RelatedForms: buildRelatedForms(entry.Lemma.Forms, queriedForm),
		Syllables:    entry.Lemma.Syllables,
		Categories:   categories,
		Irregular:    isIrregular,
		Completeness: completeness,
	}
	setTimestampsFromLexemes(word, entry.Lexemies)
	return word
}

// findFormByText finds a form by its surface text (case-insensitive match on normalized)
func findFormByText(forms []*entity.LemmaForm, text string) *entity.LemmaForm {
	if text == "" || len(forms) == 0 {
		return nil
	}
	normalized := strings.ToLower(text)

	// Priority 1: Exact surface match
	for _, form := range forms {
		if form.Surface == text {
			return form
		}
	}

	// Priority 2: Normalized match
	for _, form := range forms {
		if form.Normalized == normalized {
			return form
		}
	}
	return nil
}

func buildRelatedForms(allForms []*entity.LemmaForm, excludeForm *entity.LemmaForm) []*dictv1.RelatedForm {
	seen := make(map[string]bool)
	var forms []*dictv1.RelatedForm

	for _, form := range allForms {
		if form == nil {
			continue
		}

		// Exclude the form being displayed
		if excludeForm != nil && form.ID == excludeForm.ID {
			continue
		}

		key := strings.ToLower(form.Surface) + string(form.FormType)
		if seen[key] {
			continue
		}
		seen[key] = true
		forms = append(forms, &dictv1.RelatedForm{
			Term:      form.Surface,
			FormType:  toPbFormType(form.FormType),
			Irregular: form.IsIrregular,
		})
	}
	sort.Slice(forms, func(i, j int) bool {
		if forms[i].Term == forms[j].Term {
			return forms[i].FormType < forms[j].FormType
		}
		return forms[i].Term < forms[j].Term
	})
	return forms
}

func aggregateMeanings(lexemes []entity.Lexeme) []*dictv1.Meaning {
	type bucket struct {
		meaning *dictv1.Meaning
		index   int
	}
	meanings := make(map[string]*bucket)
	order := make([]string, 0, len(lexemes))

	for i := range lexemes {
		lex := &lexemes[i]
		externalID := lex.ExternalID
		if _, ok := meanings[externalID]; !ok {
			meanings[externalID] = &bucket{
				meaning: &dictv1.Meaning{
					LexemeId: externalID,
					Pos:      lex.PartOfSpeech,
				},
				index: len(order),
			}
			order = append(order, externalID)
		}
		b := meanings[externalID]
		target := b.meaning

		for _, sense := range lex.Senses {
			target.Definitions = append(target.Definitions, &dictv1.Definition{
				Language: ToPbLanguage(sense.Language),
				Gloss:    sense.Gloss,
			})
			for _, ex := range sense.Examples {
				target.Examples = append(target.Examples, &dictv1.Sentence{
					Text: ex.Text,
				})
			}
		}
	}

	out := make([]*dictv1.Meaning, 0, len(order))
	for _, externalID := range order {
		out = append(out, meanings[externalID].meaning)
	}
	return out
}

func mapPhonetics(phonetics []entity.Phonetic) []*dictv1.Phonetic {
	out := make([]*dictv1.Phonetic, 0, len(phonetics))
	for _, p := range phonetics {
		out = append(out, &dictv1.Phonetic{
			Ipa:     p.IPA,
			Dialect: p.Dialect,
		})
	}
	return out
}

func setTimestampsFromLexemes(word *dictv1.Word, lexemes []entity.Lexeme) {
	if len(lexemes) == 0 {
		return
	}
	newest := lexemes[0].UpdatedAt
	oldest := lexemes[0].CreatedAt
	for i := 1; i < len(lexemes); i++ {
		lex := &lexemes[i]
		if lex.UpdatedAt.After(newest) {
			newest = lex.UpdatedAt
		}
		if lex.CreatedAt.Before(oldest) {
			oldest = lex.CreatedAt
		}
	}
	if !oldest.IsZero() {
		word.CreatedAt = timestamppb.New(oldest)
	}
	if !newest.IsZero() {
		word.UpdatedAt = timestamppb.New(newest)
	}
}
