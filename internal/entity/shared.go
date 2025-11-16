package entity

import "strings"

// Language represents supported language codes using ISO-style abbreviations.
type Language string

const (
	LanguageUnspecified Language = ""
	LanguageEnglish     Language = "en"
	LanguageChinese     Language = "zh"
	LanguageSpanish     Language = "es"
	LanguageFrench      Language = "fr"
	LanguageGerman      Language = "de"
	LanguageJapanese    Language = "ja"
	LanguageKorean      Language = "ko"
)

// Code returns the lowercase language code (without defaulting).
func (l Language) Code() string {
	return strings.TrimSpace(string(l))
}

// CodeOrDefault returns the language code, falling back to English when unspecified.
func (l Language) CodeOrDefault() string {
	if l.Code() == "" {
		return string(LanguageEnglish)
	}
	return l.Code()
}

// NormalizeLanguage ensures the language falls back to a supported value (defaults to English).
func NormalizeLanguage(lang Language) Language {
	switch lang {
	case LanguageEnglish, LanguageChinese, LanguageSpanish, LanguageFrench, LanguageGerman, LanguageJapanese, LanguageKorean:
		return lang
	default:
		return LanguageEnglish
	}
}

// ParseLanguage converts an arbitrary string into a supported Language value.
func ParseLanguage(code string) Language {
	switch strings.ToLower(strings.TrimSpace(code)) {
	case "en":
		return LanguageEnglish
	case "zh":
		return LanguageChinese
	case "es":
		return LanguageSpanish
	case "fr":
		return LanguageFrench
	case "de":
		return LanguageGerman
	case "ja":
		return LanguageJapanese
	case "ko":
		return LanguageKorean
	case "":
		return LanguageUnspecified
	default:
		return LanguageUnspecified
	}
}
