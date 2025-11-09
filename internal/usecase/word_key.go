package usecase

import (
	"fmt"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
)

// makeWID generates a stable Word ID from language and lemma
// Format: {language}:{lemma}
// Example: "en:run"
func makeWID(language entity.Language, lemma string) string {
	lang := entity.NormalizeLanguage(language).CodeOrDefault()
	return fmt.Sprintf("%s:%s", lang, strings.ToLower(strings.TrimSpace(lemma)))
}

// makeLID generates a stable Lexeme ID from language, lemma, and POS
// Format: {language}:{lemma}:{pos}
// Example: "en:run:verb"
func makeLID(language entity.Language, lemma, pos string) string {
	lang := entity.NormalizeLanguage(language).CodeOrDefault()
	return fmt.Sprintf("%s:%s:%s", lang, strings.ToLower(strings.TrimSpace(lemma)), strings.ToLower(strings.TrimSpace(pos)))
}

// makeWordKey is deprecated, use makeWID instead
func makeWordKey(language entity.Language, lemma string) string {
	return makeWID(language, lemma)
}
