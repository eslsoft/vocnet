package mapping

import (
	"sort"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

// ToEntityWordStatsFilter converts a protobuf request into a domain filter.
func ToEntityWordStatsFilter(req *dictv1.GetWordStatsRequest) *entity.WordStatsFilter {
	if req == nil || len(req.GetLanguages()) == 0 {
		return nil
	}

	filter := &entity.WordStatsFilter{
		Languages: make([]entity.Language, 0, len(req.GetLanguages())),
	}
	seen := make(map[entity.Language]struct{}, len(req.GetLanguages()))

	for _, pbLang := range req.GetLanguages() {
		lang := FromPbLanguage(pbLang)
		if lang == entity.LanguageUnspecified {
			continue
		}
		if _, ok := seen[lang]; ok {
			continue
		}
		seen[lang] = struct{}{}
		filter.Languages = append(filter.Languages, lang)
	}

	if len(filter.Languages) == 0 {
		return nil
	}
	sort.Slice(filter.Languages, func(i, j int) bool {
		return strings.Compare(filter.Languages[i].Code(), filter.Languages[j].Code()) < 0
	})

	return filter
}

// ToPbWordStats maps a domain stats struct back to the protobuf response.
func ToPbWordStats(stats *entity.WordStats) *dictv1.GetWordStatsResponse {
	if stats == nil {
		return &dictv1.GetWordStatsResponse{}
	}

	resp := &dictv1.GetWordStatsResponse{
		Summary: &dictv1.WordStatsSummary{
			TotalWords:       stats.Summary.TotalWords,
			TotalLexemes:     stats.Summary.TotalLexemes,
			TotalForms:       stats.Summary.TotalForms,
			AvgCompleteness:  stats.Summary.AvgCompleteness,
			NewWordsLast_24H: stats.Summary.NewLast24h,
			NewWordsLast_7D:  stats.Summary.NewLast7d,
		},
		Coverage: &dictv1.WordCoverage{
			Phonetics:   stats.Coverage.Phonetics,
			Categories:  stats.Coverage.Categories,
			Definitions: stats.Coverage.Definitions,
			Forms:       stats.Coverage.Forms,
		},
	}

	if len(stats.Languages) > 0 {
		resp.Languages = make([]*dictv1.WordLanguageStats, 0, len(stats.Languages))
		for _, langStat := range stats.Languages {
			resp.Languages = append(resp.Languages, &dictv1.WordLanguageStats{
				Language:           ToPbLanguage(langStat.Language),
				WordCount:          langStat.WordCount,
				LexemeCount:        langStat.LexemeCount,
				AvgCompleteness:    langStat.AvgCompleteness,
				PhoneticCoverage:   langStat.PhoneticCoverage,
				DefinitionCoverage: langStat.DefinitionCoverage,
				FormCoverage:       langStat.FormCoverage,
				CategoryCoverage:   langStat.CategoryCoverage,
			})
		}
	}

	if len(stats.TopCategories) > 0 {
		resp.TopCategories = make([]*dictv1.CategoryStats, 0, len(stats.TopCategories))
		for _, cat := range stats.TopCategories {
			resp.TopCategories = append(resp.TopCategories, &dictv1.CategoryStats{
				Category:  cat.Category,
				WordCount: cat.Count,
			})
		}
	}

	if len(stats.Completeness) > 0 {
		resp.Completeness = make([]*dictv1.CompletenessBucket, 0, len(stats.Completeness))
		for _, bucket := range stats.Completeness {
			resp.Completeness = append(resp.Completeness, &dictv1.CompletenessBucket{
				Label: bucket.Label,
				Min:   bucket.Min,
				Max:   bucket.Max,
				Count: bucket.Count,
			})
		}
	}

	return resp
}
