package connectrpc

import (
	"github.com/eslsoft/vocnet/pkg/filterexpr"
)

var listWordsSchema = filterexpr.ResourceSchema{
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

var listLearnedWordsFilterSchema = filterexpr.ResourceSchema{
	Filter: map[string]filterexpr.FilterField{
		"language": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpEQ: "Language"},
		},
		"keyword": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpEQ: "Keyword"},
		},
		"surface": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpIN: "SurfaceTerms"},
		},
		"category": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpIN: "Categories"},
		},
		"tag": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpIN: "Tags"},
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

var listWordbooksSchema = filterexpr.ResourceSchema{
	Filter: map[string]filterexpr.FilterField{
		"name": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpSW: "NameQuery"},
		},
		"language": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpEQ: "Language"},
		},
		"visibility": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpEQ: "Visibility"},
		},
	},
	Order: filterexpr.OrderSchema{
		DefaultPrimary:     "sort_order",
		DefaultPrimaryDesc: false,
		FallbackKey:        "id",
		FallbackDesc:       false,
		Fields: map[string]filterexpr.OrderField{
			"sort_order": {Expr: "sort_order", Nulls: "last"},
			"name":       {Expr: "name", Nulls: "last"},
			"created_at": {Expr: "created_at", Nulls: "last"},
			"updated_at": {Expr: "updated_at", Nulls: "last"},
			"id":         {Expr: "id", Nulls: "last"},
		},
	},
}

var listReviewPlansSchema = filterexpr.ResourceSchema{
	Filter: map[string]filterexpr.FilterField{
		"name": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpSW: "NameQuery"},
		},
	},
	Order: filterexpr.OrderSchema{
		DefaultPrimary:     "id",
		DefaultPrimaryDesc: false,
		FallbackKey:        "id",
		FallbackDesc:       false,
		Fields: map[string]filterexpr.OrderField{
			"id":         {Expr: "id", Nulls: "last"},
			"name":       {Expr: "name", Nulls: "last"},
			"created_at": {Expr: "created_at", Nulls: "last"},
			"updated_at": {Expr: "updated_at", Nulls: "last"},
		},
	},
}
