package pipeline

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/adapter/provider/ecdict"
	"github.com/eslsoft/vocnet/internal/entity"
)

// ECDICTProcessor enriches lexemes (senses/categories) and lemma metadata (frequencies) from ECDICT.
type ECDICTProcessor struct {
	reader     *ecdict.Reader
	aggregator *DataAggregator
}

// NewECDICTProcessor creates a new ECDICTProcessor.
func NewECDICTProcessor(reader *ecdict.Reader) *ECDICTProcessor {
	return &ECDICTProcessor{
		reader:     reader,
		aggregator: NewDataAggregator(),
	}
}

func (p *ECDICTProcessor) Name() string { return "ecdict" }

func (p *ECDICTProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	if p.reader == nil {
		return nil, &ErrProcessorSkipped{Reason: "ecdict not available"}
	}

	entry, err := p.reader.Lookup(ctx, pctx.Term)
	if err != nil {
		return nil, fmt.Errorf("ecdict lookup: %w", err)
	}

	if entry == nil {
		return &ProcessResult{Status: ProcessStatusNoData}, nil
	}

	// Parse ECDICT data
	parsed := p.parseECDICT(entry)

	// Build result lexeme: enrich existing or create new
	var lexeme *entity.Lexeme
	if len(pctx.Lexemes) > 0 {
		lexeme = enrichExistingLexeme(pctx.Lexemes[0], parsed, p.aggregator)
	} else {
		lexeme = createLexemeFromECDICT(parsed)
	}
	lemmaUpdate := buildLemmaUpdate(pctx.Lemma, parsed, p.aggregator)

	// Build form updates with ECDICT phonetic for the lemma form
	var forms []*entity.LemmaForm
	if entry.Phonetic != "" {
		forms = append(forms, &entity.LemmaForm{
			Surface:  pctx.Term,
			FormType: entity.LexemeFormTypeLemma,
			Phonetics: []entity.Phonetic{
				{IPA: entry.Phonetic, Dialect: "en-GB"},
			},
		})
	}

	return &ProcessResult{
		Status:      ProcessStatusExecuted,
		Evidence:    []*entity.RawEvidence{parsed.Evidence},
		Lexemes:     []*entity.Lexeme{lexeme},
		Forms:       forms,
		LemmaUpdate: lemmaUpdate,
	}, nil
}

// parsedECDICTData holds parsed ECDICT data.
type parsedECDICTData struct {
	Evidence     *entity.RawEvidence
	Senses       []entity.LexemeSense
	Frequencies  []entity.Frequency
	Categories   []string
	Completeness int32
	POS          string
}

func (p *ECDICTProcessor) parseECDICT(entry *ecdict.ECDICTEntry) *parsedECDICTData {
	return &parsedECDICTData{
		Evidence:     createECDICTEvidence(entry),
		Senses:       parseSensesFromECDICT(entry),
		Frequencies:  parseFrequenciesFromECDICT(entry),
		Categories:   ExtractDomainCategories(entry.Tags),
		Completeness: calculateCompletenessScore(entry),
		POS:          normalizePOSLabel(entry.POS),
	}
}

func enrichExistingLexeme(lexeme *entity.Lexeme, data *parsedECDICTData, aggregator *DataAggregator) *entity.Lexeme {
	enriched := *lexeme

	if len(data.Senses) > 0 {
		enriched.Senses = aggregator.MergeSenses(lexeme.Senses, data.Senses)
	}
	if data.POS != "" && strings.TrimSpace(lexeme.PartOfSpeech) == "" {
		enriched.PartOfSpeech = data.POS
	}
	if strings.TrimSpace(enriched.SenseGloss) == "" {
		enriched.SenseGloss = pickSenseGloss(enriched.Senses)
	}
	if lexeme.Completeness == 0 {
		enriched.Completeness = data.Completeness
	}
	if len(data.Categories) > 0 {
		enriched.Categories = appendUnique(lexeme.Categories, data.Categories...)
	}

	return &enriched
}

func createLexemeFromECDICT(data *parsedECDICTData) *entity.Lexeme {
	return &entity.Lexeme{
		ExternalID:   fmt.Sprintf("ecdict-%s", data.Evidence.Content["word"]),
		Language:     entity.LanguageEnglish,
		PartOfSpeech: data.POS,
		EntryType:    entity.LexemeEntryTypeWord,
		SenseGloss:   pickSenseGloss(data.Senses),
		Senses:       data.Senses,
		Categories:   data.Categories,
		Completeness: data.Completeness,
	}
}

func buildLemmaUpdate(lemma *entity.Lemma, data *parsedECDICTData, aggregator *DataAggregator) *entity.Lemma {
	if lemma == nil {
		return nil
	}
	updated := *lemma
	if len(data.Frequencies) > 0 {
		updated.Frequencies = aggregator.MergeFrequencies(lemma.Frequencies, data.Frequencies)
	}
	return &updated
}

func createECDICTEvidence(entry *ecdict.ECDICTEntry) *entity.RawEvidence {
	return &entity.RawEvidence{
		Provider:      "ecdict",
		Phase:         int32(entity.PhaseLexical),
		Content:       buildEvidenceContent(entry),
		SchemaVersion: "ecdict-1.0",
		FetchedAt:     time.Now(),
	}
}

func buildEvidenceContent(entry *ecdict.ECDICTEntry) map[string]any {
	return map[string]any{
		"word":        entry.Word,
		"phonetic":    entry.Phonetic,
		"definition":  entry.Definition,
		"translation": entry.Translation,
		"pos":         entry.POS,
		"tags":        entry.Tags,
		"bnc":         entry.BNC,
		"frq":         entry.Frq,
		"collins":     entry.Collins,
		"oxford":      entry.Oxford,
		"exchange":    entry.ExchangeData,
	}
}

func parseSensesFromECDICT(entry *ecdict.ECDICTEntry) []entity.LexemeSense {
	senses := []entity.LexemeSense{}

	if entry.Definition != "" {
		for _, def := range splitAndTrim(entry.Definition, ";") {
			senses = append(senses, entity.LexemeSense{
				Language: entity.LanguageEnglish,
				Gloss:    def,
			})
		}
	}

	if entry.Translation != "" {
		for _, trans := range splitAndTrim(entry.Translation, ";") {
			senses = append(senses, entity.LexemeSense{
				Language: entity.LanguageChinese,
				Gloss:    trans,
			})
		}
	}

	return senses
}

func parseFrequenciesFromECDICT(entry *ecdict.ECDICTEntry) []entity.Frequency {
	frequencies := []entity.Frequency{}

	if entry.BNC > 0 {
		frequencies = append(frequencies, entity.Frequency{
			Corpus: "bnc",
			Count:  int64(entry.BNC),
		})
	}

	if entry.Frq > 0 {
		frequencies = append(frequencies, entity.Frequency{
			Corpus: "frq",
			Count:  int64(entry.Frq),
		})
	}

	return frequencies
}

func calculateCompletenessScore(entry *ecdict.ECDICTEntry) int32 {
	score := int32(0)

	if entry.Definition != "" {
		score += 30
	}
	if entry.Translation != "" {
		score += 20
	}
	if entry.Phonetic != "" {
		score += 15
	}
	if entry.POS != "" {
		score += 10
	}
	if entry.Collins > 0 {
		score += 10
	}
	if entry.Oxford {
		score += 10
	}
	if entry.ExchangeData != "" {
		score += 5
	}

	if score > 100 {
		score = 100
	}

	return score
}

func splitAndTrim(s string, delimiter string) []string {
	parts := strings.Split(s, delimiter)
	result := make([]string, 0, len(parts))

	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}

	return result
}
