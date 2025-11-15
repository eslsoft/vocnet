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
	if entry.IsQueriedLemma() {
		return buildLemmaView(entry)
	}
	return buildFormView(entry)
}

func buildLemmaView(entry *entity.WordEntry) *dictv1.Word {
	allForms := entry.GetAllForms()
	var lemmaPhonetics []entity.Phonetic
	for _, form := range allForms {
		if form.FormType == entity.LexemeFormTypeLemma {
			lemmaPhonetics = form.Phonetics
			break
		}
	}

	word := &dictv1.Word{
		Id:           entry.Lemma.ID,
		Term:         entry.Lemma.Text,
		TermType:     dictv1.FormType_FORM_TYPE_LEMMA,
		Lemma:        nil,
		Language:     ToPbLanguage(entry.Lemma.Language),
		Phonetics:    mapPhonetics(lemmaPhonetics),
		Meanings:     aggregateMeanings(entry.Lemma.Lexemes),
		RelatedForms: buildRelatedForms(allForms, true),
		Categories:   entry.Lemma.Categories,
		Irregular:    false,
		Completeness: entry.Lemma.Completeness,
	}
	setTimestamps(word, entry.Lemma.Lexemes)
	return word
}

func buildFormView(entry *entity.WordEntry) *dictv1.Word {
	queriedForm := entry.FindQueriedForm()
	var phonetics []entity.Phonetic
	if queriedForm != nil {
		phonetics = queriedForm.Phonetics
	}
	lemmaText := entry.Lemma.Text
	word := &dictv1.Word{
		Id:           entry.Lemma.ID,
		Term:         entry.QueriedTerm,
		TermType:     toPbFormType(entry.QueriedFormType),
		Lemma:        &lemmaText,
		Language:     ToPbLanguage(entry.Lemma.Language),
		Phonetics:    mapPhonetics(phonetics),
		Meanings:     aggregateMeanings(entry.Lemma.Lexemes),
		RelatedForms: nil,
		Categories:   entry.Lemma.Categories,
		Irregular:    entry.IsIrregular,
		Completeness: entry.Lemma.Completeness,
	}
	setTimestamps(word, entry.Lemma.Lexemes)
	return word
}

func buildRelatedForms(allForms []entity.LexemeForm, excludeLemma bool) []*dictv1.RelatedForm {
	seen := make(map[string]bool)
	var forms []*dictv1.RelatedForm

	for _, form := range allForms {
		if excludeLemma && form.FormType == entity.LexemeFormTypeLemma {
			continue
		}
		key := strings.ToLower(form.Text) + string(form.FormType)
		if seen[key] {
			continue
		}
		seen[key] = true
		forms = append(forms, &dictv1.RelatedForm{
			Term:      form.Text,
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

func aggregateMeanings(lexemes []*entity.Lexeme) []*dictv1.Meaning {
	type bucket struct {
		meaning *dictv1.Meaning
		index   int
	}
	meanings := make(map[string]*bucket)
	order := make([]string, 0, len(lexemes))

	for _, lex := range lexemes {
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
		target := meanings[externalID].meaning

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

func fromPbPhonetics(phonetics []*dictv1.Phonetic) []entity.Phonetic {
	if len(phonetics) == 0 {
		return nil
	}
	out := make([]entity.Phonetic, 0, len(phonetics))
	for _, p := range phonetics {
		out = append(out, entity.Phonetic{
			IPA:     strings.TrimSpace(p.GetIpa()),
			Dialect: strings.TrimSpace(p.GetDialect()),
		})
	}
	return out
}

func setTimestamps(word *dictv1.Word, lexemes []*entity.Lexeme) {
	if len(lexemes) == 0 {
		return
	}
	newest := lexemes[0].UpdatedAt
	oldest := lexemes[0].CreatedAt
	for _, lex := range lexemes[1:] {
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

// ToEntityLemma converts a proto Word message into the lemma aggregate used internally.
func ToEntityLemma(pb *dictv1.Word) *entity.Lemma {
	if pb == nil {
		return nil
	}
	lemmaText := pb.GetTerm()
	if pb.Lemma != nil && strings.TrimSpace(pb.GetLemma()) != "" {
		lemmaText = pb.GetLemma()
	}

	lemma := &entity.Lemma{
		ID:           pb.GetId(),
		Text:         strings.TrimSpace(lemmaText),
		Language:     FromPbLanguage(pb.GetLanguage()),
		Completeness: pb.GetCompleteness(),
		Categories:   pb.GetCategories(),
	}
	lemma.Lexemes = meaningsToLexemes(pb, lemma.Language, lemma.Text)
	return lemma
}

func meaningsToLexemes(pb *dictv1.Word, wordLang entity.Language, lemma string) []*entity.Lexeme {
	meanings := pb.GetMeanings()
	if len(meanings) == 0 {
		return nil
	}

	lexemes := make([]*entity.Lexeme, 0, len(meanings))
	for _, meaning := range meanings {
		lex := &entity.Lexeme{
			ExternalID:   meaning.GetLexemeId(),
			Language:     wordLang,
			Lemma:        lemma,
			PartOfSpeech: meaning.GetPos(),
		}

		lemmaForm := entity.LexemeForm{
			Text:        lemma,
			FormType:    entity.LexemeFormTypeLemma,
			IsIrregular: false,
		}
		lemmaForm.Phonetics = fromPbPhonetics(pb.GetPhonetics())
		lex.Forms = append(lex.Forms, lemmaForm)
		for _, relForm := range pb.GetRelatedForms() {
			lex.Forms = append(lex.Forms, entity.LexemeForm{
				Text:        relForm.GetTerm(),
				FormType:    fromPbFormType(relForm.GetFormType()),
				IsIrregular: relForm.GetIrregular(),
			})
		}

		if len(meaning.GetDefinitions()) > 0 {
			lex.Senses = make([]entity.LexemeSense, 0, len(meaning.GetDefinitions()))
			for i, def := range meaning.GetDefinitions() {
				sense := entity.LexemeSense{
					Language: FromPbLanguage(def.GetLanguage()),
					Gloss:    def.GetGloss(),
				}
				if i == 0 && len(meaning.GetExamples()) > 0 {
					for _, ex := range meaning.GetExamples() {
						sense.Examples = append(sense.Examples, entity.SenseExample{
							Text: ex.GetText(),
						})
					}
				}
				lex.Senses = append(lex.Senses, sense)
			}
		}
		lexemes = append(lexemes, lex)
	}

	return lexemes
}

func toPbFormType(in entity.LexemeFormType) dictv1.FormType {
	switch in {
	case entity.LexemeFormTypeLemma:
		return dictv1.FormType_FORM_TYPE_LEMMA
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
	default:
		return dictv1.FormType_FORM_TYPE_UNSPECIFIED
	}
}

func fromPbFormType(pbType dictv1.FormType) entity.LexemeFormType {
	switch pbType {
	case dictv1.FormType_FORM_TYPE_LEMMA:
		return entity.LexemeFormTypeLemma
	case dictv1.FormType_FORM_TYPE_PLURAL:
		return entity.LexemeFormTypePlural
	case dictv1.FormType_FORM_TYPE_PAST:
		return entity.LexemeFormTypePast
	case dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE:
		return entity.LexemeFormTypePastParticiple
	case dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE:
		return entity.LexemeFormTypePresentParticiple
	case dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR:
		return entity.LexemeFormTypeThirdPersonSingular
	case dictv1.FormType_FORM_TYPE_COMPARATIVE:
		return entity.LexemeFormTypeComparative
	case dictv1.FormType_FORM_TYPE_SUPERLATIVE:
		return entity.LexemeFormTypeSuperlative
	case dictv1.FormType_FORM_TYPE_IMPERATIVE:
		return entity.LexemeFormTypeImperative
	case dictv1.FormType_FORM_TYPE_SUBJUNCTIVE:
		return entity.LexemeFormTypeSubjunctive
	case dictv1.FormType_FORM_TYPE_GERUND:
		return entity.LexemeFormTypeGerund
	case dictv1.FormType_FORM_TYPE_SHORT_FORM:
		return entity.LexemeFormTypeShortForm
	default:
		return entity.LexemeFormTypeUnspecified
	}
}

func defaultFormType(ft entity.LexemeFormType) entity.LexemeFormType {
	if ft == entity.LexemeFormTypeUnspecified {
		return entity.LexemeFormTypeLemma
	}
	return ft
}
