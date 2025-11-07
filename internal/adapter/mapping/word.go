package mapping

import (
	"strings"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/eslsoft/vocnet/internal/entity"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
	"github.com/samber/lo"
)

func FromPbWord(in *dictv1.Word) *entity.Word {
	word := &entity.Word{
		ID:       in.GetId(),
		Text:     strings.TrimSpace(in.GetText()),
		Language: FromPbLanguage(in.GetLanguage()),
		WordType: strings.TrimSpace(in.GetWordType()),
		Phonetics: lo.Map(in.GetPhonetics(), func(p *dictv1.Phonetic, _ int) entity.WordPhonetic {
			return entity.WordPhonetic{
				IPA:     strings.TrimSpace(p.GetIpa()),
				Dialect: strings.TrimSpace(p.GetDialect()),
			}
		}),
		Definitions: lo.Map(in.GetDefinitions(), func(def *dictv1.Definition, _ int) entity.WordDefinition {
			return entity.WordDefinition{
				Pos:      strings.TrimSpace(def.GetPos()),
				Text:     strings.TrimSpace(def.GetText()),
				Language: FromPbLanguage(def.GetLanguage()),
			}
		}),
		Forms: lo.Map(in.GetForms(), func(form *dictv1.WordFormRef, _ int) entity.WordFormRef {
			return entity.WordFormRef{
				Text:     strings.TrimSpace(form.GetText()),
				WordType: strings.TrimSpace(form.GetWordType()),
			}
		}),
		Phrases: lo.Map(in.GetPhrases(), func(phrase *dictv1.Phrase, _ int) entity.Phrase {
			return entity.Phrase{
				Text:     strings.TrimSpace(phrase.GetText()),
				Language: FromPbLanguage(phrase.GetLanguage()),
				Definitions: lo.Map(phrase.GetDefinitions(), func(def *dictv1.PhraseDefinition, _ int) entity.WordDefinition {
					return entity.WordDefinition{
						Text:     strings.TrimSpace(def.GetText()),
						Language: FromPbLanguage(def.GetLanguage()),
					}
				}),
			}
		}),
		Sentences: lo.Map(in.GetSentences(), func(sent *dictv1.Sentence, _ int) entity.Sentence {
			return entity.Sentence{
				Text:      strings.TrimSpace(sent.GetText()),
				Source:    int32(sent.GetSource()),
				SourceRef: strings.TrimSpace(sent.GetSourceRef()),
			}
		}),
		Relations: lo.Map(in.GetRelations(), func(rel *dictv1.WordRelation, _ int) entity.WordRelation {
			return entity.WordRelation{
				Word:         strings.TrimSpace(rel.GetWord()),
				RelationType: int32(rel.GetRelationType()),
			}
		}),
		Categories:     in.GetCategories(),
		Completeness:   in.GetCompleteness(),
		IsStandardRule: in.GetIsStandardRule(),
		IsManualEdited: in.GetIsManualEdited(),
	}
	if lemma := strings.TrimSpace(in.GetLemma()); lemma != "" {
		word.Lemma = &lemma
	}

	return word
}

func ToPbWord(v *entity.Word) *dictv1.Word {
	if v == nil {
		return nil
	}
	pv := &dictv1.Word{
		Id:       v.ID,
		Text:     v.Text,
		Language: ToPbLanguage(v.Language),
		WordType: v.WordType,
		Phonetics: lo.Map(v.Phonetics, func(p entity.WordPhonetic, _ int) *dictv1.Phonetic {
			return &dictv1.Phonetic{Ipa: p.IPA, Dialect: p.Dialect}
		}),
		Definitions: lo.Map(v.Definitions, func(def entity.WordDefinition, _ int) *dictv1.Definition { return ToPbDefinition(def) }),
		Forms: lo.Map(v.Forms, func(form entity.WordFormRef, _ int) *dictv1.WordFormRef {
			return &dictv1.WordFormRef{Text: form.Text, WordType: form.WordType}
		}),
		Categories: v.Categories,
		Phrases: lo.Map(v.Phrases, func(phrase entity.Phrase, _ int) *dictv1.Phrase {
			return &dictv1.Phrase{
				Text:     phrase.Text,
				Language: ToPbLanguage(phrase.Language),
				Definitions: lo.Map(phrase.Definitions, func(def entity.WordDefinition, _ int) *dictv1.PhraseDefinition {
					return &dictv1.PhraseDefinition{Language: ToPbLanguage(def.Language), Text: def.Text}
				}),
			}
		}),
		Sentences: lo.Map(v.Sentences, func(sent entity.Sentence, _ int) *dictv1.Sentence {
			return &dictv1.Sentence{Text: sent.Text, Source: commonv1.SourceType(sent.Source), SourceRef: sent.SourceRef}
		}),
		Relations: lo.Map(v.Relations, func(rel entity.WordRelation, _ int) *dictv1.WordRelation {
			return &dictv1.WordRelation{Word: rel.Word, RelationType: commonv1.RelationType(rel.RelationType)}
		}),
		Completeness:   v.Completeness,
		IsStandardRule: v.IsStandardRule,
		IsManualEdited: v.IsManualEdited,
		CreatedAt:      timestamppb.New(v.CreatedAt),
		UpdatedAt:      timestamppb.New(v.UpdatedAt),
	}

	if v.Lemma != nil {
		pv.Lemma = *v.Lemma
	}

	return pv
}

func ToPbDefinition(def entity.WordDefinition) *dictv1.Definition {
	lang := ToPbLanguage(def.Language)
	if lang == commonv1.Language_LANGUAGE_UNSPECIFIED {
		lang = commonv1.Language_LANGUAGE_ENGLISH
	}
	return &dictv1.Definition{
		Pos:      def.Pos,
		Text:     def.Text,
		Language: lang,
	}
}

func ToPbLanguage(lang entity.Language) commonv1.Language {
	switch lang {
	case entity.LanguageEnglish:
		return commonv1.Language_LANGUAGE_ENGLISH
	case entity.LanguageChinese:
		return commonv1.Language_LANGUAGE_CHINESE
	case entity.LanguageSpanish:
		return commonv1.Language_LANGUAGE_SPANISH
	case entity.LanguageFrench:
		return commonv1.Language_LANGUAGE_FRENCH
	case entity.LanguageGerman:
		return commonv1.Language_LANGUAGE_GERMAN
	case entity.LanguageJapanese:
		return commonv1.Language_LANGUAGE_JAPANESE
	case entity.LanguageKorean:
		return commonv1.Language_LANGUAGE_KOREAN
	case entity.LanguageUnspecified:
		fallthrough
	default:
		return commonv1.Language_LANGUAGE_UNSPECIFIED
	}
}

func FromPbLanguage(lang commonv1.Language) entity.Language {
	switch lang {
	case commonv1.Language_LANGUAGE_ENGLISH:
		return entity.LanguageEnglish
	case commonv1.Language_LANGUAGE_CHINESE:
		return entity.LanguageChinese
	case commonv1.Language_LANGUAGE_SPANISH:
		return entity.LanguageSpanish
	case commonv1.Language_LANGUAGE_FRENCH:
		return entity.LanguageFrench
	case commonv1.Language_LANGUAGE_GERMAN:
		return entity.LanguageGerman
	case commonv1.Language_LANGUAGE_JAPANESE:
		return entity.LanguageJapanese
	case commonv1.Language_LANGUAGE_KOREAN:
		return entity.LanguageKorean
	case commonv1.Language_LANGUAGE_UNSPECIFIED:
		fallthrough
	default:
		return entity.LanguageUnspecified
	}
}
