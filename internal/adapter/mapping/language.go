package mapping

import (
	"strings"

	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"

	"github.com/eslsoft/vocnet/internal/entity"
)

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
	default:
		return entity.LanguageUnspecified
	}
}

func ToPbLanguage(lang entity.Language) commonv1.Language {
	switch strings.ToUpper(lang.CodeOrDefault()) {
	case entity.LanguageEnglish.Code():
		return commonv1.Language_LANGUAGE_ENGLISH
	case entity.LanguageChinese.Code():
		return commonv1.Language_LANGUAGE_CHINESE
	case entity.LanguageSpanish.Code():
		return commonv1.Language_LANGUAGE_SPANISH
	case entity.LanguageFrench.Code():
		return commonv1.Language_LANGUAGE_FRENCH
	case entity.LanguageGerman.Code():
		return commonv1.Language_LANGUAGE_GERMAN
	case entity.LanguageJapanese.Code():
		return commonv1.Language_LANGUAGE_JAPANESE
	case entity.LanguageKorean.Code():
		return commonv1.Language_LANGUAGE_KOREAN
	default:
		return commonv1.Language_LANGUAGE_UNSPECIFIED
	}
}
