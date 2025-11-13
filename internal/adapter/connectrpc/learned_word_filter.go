package connectrpc

import (
	"github.com/eslsoft/vocnet/pkg/filterexpr"
)

var learnedWordFilterSchema = filterexpr.ResourceSchema{
	Filter: map[string]filterexpr.FilterField{
		"keyword": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpEQ: "Keyword"},
		},
		"language": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpEQ: "Language"},
		},
		"word_id": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpIN: "WordIDs"},
		},
		"surface": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpIN: "SurfaceTerms"},
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
