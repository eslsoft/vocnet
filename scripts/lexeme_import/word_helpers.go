package main

import (
	"strings"

	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

func lemmaText(word *dictv1.Word) string {
	if word == nil {
		return ""
	}
	if lemma := strings.TrimSpace(word.GetLemma()); lemma != "" {
		return lemma
	}
	return strings.TrimSpace(word.GetTerm())
}
