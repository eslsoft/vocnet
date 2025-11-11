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

	pbLang := ToPbLanguage(word.Language)

	out := &dictv1.Word{
		Id:           word.ID,
		Lemma:        word.Lemma,
		Language:     pbLang,
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
		LexemeID string // External Lexeme ID
		Text     string
		Type     entity.LexemeFormType
	}
	bucket := make(map[formKey]*dictv1.WordForm)

	for _, lex := range lexemes {
		for _, form := range lex.Forms {
			text := strings.TrimSpace(form.Text)
			if text == "" {
				continue
			}
			key := formKey{
				LexemeID: lex.ExternalID,
				Text:     strings.ToLower(text),
				Type:     defaultFormType(form.FormType),
			}
			entry, ok := bucket[key]
			if !ok {
				entry = &dictv1.WordForm{
					LexemeId:  lex.ExternalID,
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
		if keys[i].LexemeID != keys[j].LexemeID {
			return keys[i].LexemeID < keys[j].LexemeID
		}
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
	defs := make(map[string]*bucket) // key: external_id
	order := make([]string, 0)

	for _, lex := range lexemes {
		externalID := lex.ExternalID
		if _, ok := defs[externalID]; !ok {
			defs[externalID] = &bucket{
				definition: &dictv1.Definition{
					LexemeId: externalID,
					Pos:      lex.PartOfSpeech,
				},
				index: len(order),
			}
			order = append(order, externalID)
		}
		target := defs[externalID].definition

		for _, sense := range lex.Senses {
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
	for _, externalID := range order {
		out = append(out, defs[externalID].definition)
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

// ToEntityWord converts a proto Word to an entity Word
func ToEntityWord(pb *dictv1.Word) *entity.Word {
	if pb == nil {
		return nil
	}

	word := &entity.Word{
		ID:           pb.GetId(),
		Lemma:        pb.GetLemma(),
		Language:     FromPbLanguage(pb.GetLanguage()),
		Completeness: pb.GetCompleteness(),
		Categories:   pb.GetCategories(),
	}

	// Map phonetics
	if len(pb.GetPhonetics()) > 0 {
		word.Phonetics = make([]entity.Phonetic, 0, len(pb.GetPhonetics()))
		for _, p := range pb.GetPhonetics() {
			word.Phonetics = append(word.Phonetics, entity.Phonetic{
				IPA:     p.GetIpa(),
				Dialect: p.GetDialect(),
			})
		}
	}

	// Convert definitions to lexemes
	word.Lexemes = definitionsToLexemes(pb, word.Language)

	return word
}

// definitionsToLexemes converts proto Definitions to entity Lexemes
func definitionsToLexemes(pb *dictv1.Word, wordLang entity.Language) []*entity.Lexeme {
	definitions := pb.GetDefinitions()
	if len(definitions) == 0 {
		return nil
	}

	lexemes := make([]*entity.Lexeme, 0, len(definitions))

	for _, def := range definitions {
		lex := &entity.Lexeme{
			ExternalID:   def.GetLexemeId(),
			Language:     wordLang,
			Lemma:        pb.GetLemma(),
			PartOfSpeech: def.GetPos(),
		}

		// Filter forms that belong to this lexeme
		if len(pb.GetForms()) > 0 {
			for _, pbForm := range pb.GetForms() {
				if pbForm.GetLexemeId() == def.GetLexemeId() {
					lex.Forms = append(lex.Forms, entity.LexemeForm{
						Text:        pbForm.GetWord(),
						FormType:    fromPbFormType(pbForm.GetType()),
						IsIrregular: pbForm.GetIrregular(),
					})
				}
			}
		}

		// Convert senses and examples
		// Note: In proto, examples are at Definition level, but in entity they're at Sense level
		// We attach examples to the first sense for simplicity
		if len(def.GetSenses()) > 0 {
			lex.Senses = make([]entity.LexemeSense, 0, len(def.GetSenses()))
			for i, sense := range def.GetSenses() {
				entitySense := entity.LexemeSense{
					Language: FromPbLanguage(sense.GetLanguage()),
					Gloss:    sense.GetGloss(),
				}

				// Attach examples only to the first sense to avoid duplication
				if i == 0 && len(def.GetExamples()) > 0 {
					entitySense.Examples = make([]entity.SenseExample, 0, len(def.GetExamples()))
					for _, ex := range def.GetExamples() {
						entitySense.Examples = append(entitySense.Examples, entity.SenseExample{
							Text: ex.GetText(),
						})
					}
				}

				lex.Senses = append(lex.Senses, entitySense)
			}
		}

		lexemes = append(lexemes, lex)
	}

	return lexemes
}

// fromPbFormType converts proto FormType to entity LexemeFormType
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

// Currently unused but left for completeness if we reintroduce relation mapping later.
