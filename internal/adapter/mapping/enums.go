package mapping

import (
	"github.com/eslsoft/vocnet/internal/entity"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

var (
	pbLanguageMap = map[commonv1.Language]entity.Language{
		commonv1.Language_LANGUAGE_ENGLISH:     entity.LanguageEnglish,
		commonv1.Language_LANGUAGE_CHINESE:     entity.LanguageChinese,
		commonv1.Language_LANGUAGE_JAPANESE:    entity.LanguageJapanese,
		commonv1.Language_LANGUAGE_KOREAN:      entity.LanguageKorean,
		commonv1.Language_LANGUAGE_SPANISH:     entity.LanguageSpanish,
		commonv1.Language_LANGUAGE_FRENCH:      entity.LanguageFrench,
		commonv1.Language_LANGUAGE_GERMAN:      entity.LanguageGerman,
		commonv1.Language_LANGUAGE_UNSPECIFIED: entity.LanguageUnspecified,
	}
	entityLanguageMap = map[entity.Language]commonv1.Language{
		entity.LanguageEnglish:     commonv1.Language_LANGUAGE_ENGLISH,
		entity.LanguageChinese:     commonv1.Language_LANGUAGE_CHINESE,
		entity.LanguageJapanese:    commonv1.Language_LANGUAGE_JAPANESE,
		entity.LanguageKorean:      commonv1.Language_LANGUAGE_KOREAN,
		entity.LanguageSpanish:     commonv1.Language_LANGUAGE_SPANISH,
		entity.LanguageFrench:      commonv1.Language_LANGUAGE_FRENCH,
		entity.LanguageGerman:      commonv1.Language_LANGUAGE_GERMAN,
		entity.LanguageUnspecified: commonv1.Language_LANGUAGE_UNSPECIFIED,
	}

	// nolint:dupl
	entityFormTypeMap = map[entity.FormType]dictv1.FormType{
		entity.FormTypeLemma:               dictv1.FormType_FORM_TYPE_LEMMA,
		entity.FormTypePlural:              dictv1.FormType_FORM_TYPE_PLURAL,
		entity.FormTypePast:                dictv1.FormType_FORM_TYPE_PAST,
		entity.FormTypePastParticiple:      dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE,
		entity.FormTypePresentParticiple:   dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE,
		entity.FormTypeThirdPersonSingular: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR,
		entity.FormTypeComparative:         dictv1.FormType_FORM_TYPE_COMPARATIVE,
		entity.FormTypeSuperlative:         dictv1.FormType_FORM_TYPE_SUPERLATIVE,
		entity.FormTypeImperative:          dictv1.FormType_FORM_TYPE_IMPERATIVE,
		entity.FormTypeSubjunctive:         dictv1.FormType_FORM_TYPE_SUBJUNCTIVE,
		entity.FormTypeGerund:              dictv1.FormType_FORM_TYPE_GERUND,
		entity.FormTypeShortForm:           dictv1.FormType_FORM_TYPE_SHORT_FORM,
		entity.FormTypeUnspecified:         dictv1.FormType_FORM_TYPE_UNSPECIFIED,
	}
)

func FromPbLanguage(lang commonv1.Language) entity.Language {
	if entLang, ok := pbLanguageMap[lang]; ok {
		return entLang
	}
	return entity.LanguageUnspecified
}

func ToPbLanguage(lang entity.Language) commonv1.Language {
	if pbLang, ok := entityLanguageMap[lang]; ok {
		return pbLang
	}
	return commonv1.Language_LANGUAGE_UNSPECIFIED
}

func toPbFormType(in entity.FormType) dictv1.FormType {
	if pbType, ok := entityFormTypeMap[in]; ok {
		return pbType
	}
	return dictv1.FormType_FORM_TYPE_UNSPECIFIED
}
