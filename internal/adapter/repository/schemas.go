package repository

import "github.com/eslsoft/vocnet/pkg/filterexpr"

var listLexemesSchema = filterexpr.ResourceSchema{
	Filter: map[string]filterexpr.FilterField{
		"keyword": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpEQ: "Keyword"},
		},
		"lexeme_id": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpIN: "LexemeIDs"},
		},
		"entry_type": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpEQ: "LexemeEntryType"},
		},
		"language": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpEQ: "Language"},
		},
	},
	Order: filterexpr.OrderSchema{
		DefaultPrimary:     "created_at",
		DefaultPrimaryDesc: true,
		FallbackKey:        "id",
		FallbackDesc:       false,
		Fields: map[string]filterexpr.OrderField{
			"created_at": {Expr: "created_at", Nulls: "last"},
			"updated_at": {Expr: "updated_at", Nulls: "last"},
			"lemma":      {Expr: "lemma", Nulls: "last"},
			"id":         {Expr: "id", Nulls: "last"},
		},
	},
}

var listLemmasSchema = filterexpr.ResourceSchema{
	Filter: map[string]filterexpr.FilterField{
		"language": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpEQ: "Language"},
		},
		"keyword": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpEQ: "Keyword"},
		},
		"category": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpIN: "Categories"},
		},
		"surface": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpIN: "SurfaceTerms"},
		},
	},
	Order: filterexpr.OrderSchema{
		DefaultPrimary:     "updated_at",
		DefaultPrimaryDesc: true,
		FallbackKey:        "lemma",
		FallbackDesc:       false,
		Fields: map[string]filterexpr.OrderField{
			"updated_at": {Expr: "updated_at", Nulls: "last"},
			"created_at": {Expr: "created_at", Nulls: "last"},
			"lemma":      {Expr: "lemma", Nulls: "last"},
		},
	},
}

var listLearnedLexemesSchema = filterexpr.ResourceSchema{
	Filter: map[string]filterexpr.FilterField{
		"keyword": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpEQ: "Keyword"},
		},
		"lexeme_id": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpIN: "LexemeIDs"},
		},
		"tag": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpIN: "Tags"},
		},
		"category": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpIN: "Categories"},
		},
	},
	Order: filterexpr.OrderSchema{
		DefaultPrimary:     "updated_at",
		DefaultPrimaryDesc: true,
		FallbackKey:        "id",
		FallbackDesc:       false,
		Fields: map[string]filterexpr.OrderField{
			"created_at":      {Expr: "created_at", Nulls: "last"},
			"updated_at":      {Expr: "updated_at", Nulls: "last"},
			"display_term":    {Expr: "display_term", Nulls: "last"},
			"mastery_overall": {Expr: "mastery_overall", Nulls: "last"},
			"id":              {Expr: "id", Nulls: "last"},
		},
	},
}
