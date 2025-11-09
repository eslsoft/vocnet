package mapping

import (
	"sort"
	"strings"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/eslsoft/vocnet/internal/entity"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

// ToPbWord converts an aggregated word entity into the dict.v1.Word proto.
func ToPbWord(word *entity.Word) *dictv1.Word {
	if word == nil {
		return nil
	}

	out := &dictv1.Word{
		Id:           word.ID,
		Lemma:        word.Lemma,
		Language:     ToPbLanguage(word.Language),
		Completeness: word.Completeness,
		Forms:        aggregateForms(word.Lexemes),
		Definitions:  aggregateDefinitions(word.Lexemes),
		Phrases:      []*dictv1.Phrase{}, // reserved for future sources
		Phonetics:    mapPhonetics(word.Phonetics),
		Categories:   word.Categories,
	}

	setTimestamps(out, word.Lexemes)
	return out
}

func aggregateForms(lexemes []*entity.Lexeme) []*dictv1.WordForm {
	type formKey struct {
		Text string
		Type entity.LexemeFormType
	}
	bucket := make(map[formKey]*dictv1.WordForm)

	for _, lex := range lexemes {
		for _, form := range lex.Forms {
			text := strings.TrimSpace(form.Text)
			if text == "" {
				continue
			}
			key := formKey{
				Text: strings.ToLower(text),
				Type: defaultFormType(form.FormType),
			}
			entry, ok := bucket[key]
			if !ok {
				entry = &dictv1.WordForm{
					Word:      text,
					Type:      toPbFormType(key.Type),
					Irregular: form.IsIrregular,
				}
				bucket[key] = entry
			} else if form.IsIrregular {
				entry.Irregular = true
			}
		}
	}

	keys := make([]formKey, 0, len(bucket))
	for k := range bucket {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].Text == keys[j].Text {
			return strings.Compare(string(keys[i].Type), string(keys[j].Type)) < 0
		}
		return keys[i].Text < keys[j].Text
	})

	out := make([]*dictv1.WordForm, 0, len(keys))
	for _, key := range keys {
		out = append(out, bucket[key])
	}
	return out
}

func aggregateDefinitions(lexemes []*entity.Lexeme) []*dictv1.Definition {
	type bucket struct {
		definition *dictv1.Definition
		index      int
	}
	defs := make(map[string]*bucket)
	order := make([]string, 0)

	getPOS := func(lex *entity.Lexeme, sense entity.LexemeSense) string {
		if strings.TrimSpace(sense.PartOfSpeech) != "" {
			return strings.TrimSpace(sense.PartOfSpeech)
		}
		if strings.TrimSpace(lex.POS) != "" {
			return strings.TrimSpace(lex.POS)
		}
		return ""
	}

	for _, lex := range lexemes {
		for _, sense := range lex.Senses {
			pos := getPOS(lex, sense)
			if _, ok := defs[pos]; !ok {
				defs[pos] = &bucket{
					definition: &dictv1.Definition{Pos: pos},
					index:      len(order),
				}
				order = append(order, pos)
			}
			target := defs[pos].definition
			target.Senses = append(target.Senses, &dictv1.LexemeSense{
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

	out := make([]*dictv1.Definition, 0, len(order))
	for _, pos := range order {
		out = append(out, defs[pos].definition)
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

func defaultFormType(ft entity.LexemeFormType) entity.LexemeFormType {
	if ft == entity.LexemeFormTypeUnspecified {
		return entity.LexemeFormTypeLemma
	}
	return ft
}

// Currently unused but left for completeness if we reintroduce relation mapping later.
