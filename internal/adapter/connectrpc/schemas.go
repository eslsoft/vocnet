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
		"level": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpIN: "Levels"},
		},
		"pos": {
			Kind: filterexpr.KindString,
			Ops:  map[filterexpr.Op]string{filterexpr.OpIN: "POS"},
		},
	},
	Order: filterexpr.OrderSchema{
		DefaultPrimary:     "updated_at",
		DefaultPrimaryDesc: true,
		FallbackKey:        "surface",
		FallbackDesc:       false,
		Fields: map[string]filterexpr.OrderField{
			"updated_at":      {Expr: "updated_at", Nulls: "last"},
			"created_at":      {Expr: "created_at", Nulls: "last"},
			"surface":         {Expr: "surface", Nulls: "last"},
			"lemma":           {Expr: "surface", Nulls: "last"}, // Alias for backward compatibility
			"quality_overall": {Expr: "quality_overall", Nulls: "last"},
			"synthesized_at":  {Expr: "synthesized_at", Nulls: "last"},
		},
	},
}
