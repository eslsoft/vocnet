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
	parsed, err := p.parseECDICT(entry)
	if err != nil {
		return nil, err
	}

	// Enrich existing lexemes with matching Chinese translations by POS.
	// Only add senses where the POS matches; discard unmatched translations.
	var lexemes []*entity.Lexeme
	for _, lex := range pctx.Lexemes {
		enriched := enrichExistingLexeme(lex, parsed, p.aggregator)
		if enriched != nil {
			lexemes = append(lexemes, enriched)
		}
	}

	lemmaUpdate := buildLemmaUpdate(pctx.Lemma, parsed, p.aggregator)

	// Build form updates with ECDICT phonetic for the lemma form
	var forms []*entity.LemmaForm
	if entry.Phonetic != "" {
		forms = append(forms, &entity.LemmaForm{
			Surface:  pctx.Term,
			FormType: entity.FormTypeLemma,
			Phonetics: []entity.Phonetic{
				{IPA: entry.Phonetic, Dialect: "en-GB"},
			},
		})
	}

	return &ProcessResult{
		Status:      ProcessStatusExecuted,
		Evidence:    []*entity.RawEvidence{parsed.Evidence},
		Lexemes:     lexemes,
		Forms:       forms,
		LemmaUpdate: lemmaUpdate,
	}, nil
}

// posTaggedSense holds a Chinese translation line with its parsed POS.
type posTaggedSense struct {
	POS   entity.PartOfSpeech
	Gloss string
}

// parsedECDICTData holds parsed ECDICT data.
type parsedECDICTData struct {
	Evidence          *entity.RawEvidence
	TranslationsByPOS map[entity.PartOfSpeech][]entity.LexemeSense
	Frequencies       []entity.Frequency
	Categories        []string
	Completeness      int32
}

func (p *ECDICTProcessor) parseECDICT(entry *ecdict.ECDICTEntry) (*parsedECDICTData, error) {
	return &parsedECDICTData{
		Evidence:          createECDICTEvidence(entry),
		TranslationsByPOS: parseChineseTranslations(entry.Translation),
		Frequencies:       parseFrequenciesFromECDICT(entry),
		Categories:        ExtractDomainCategories(entry.Tags),
		Completeness:      calculateCompletenessScore(entry),
	}, nil
}

func enrichExistingLexeme(lexeme *entity.Lexeme, data *parsedECDICTData, aggregator *DataAggregator) *entity.Lexeme {
	enriched := *lexeme

	// Only add Chinese translations whose POS matches this lexeme's POS.
	if senses, ok := data.TranslationsByPOS[lexeme.PartOfSpeech]; ok && len(senses) > 0 {
		enriched.Senses = aggregator.MergeSenses(lexeme.Senses, senses)
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

// parseChineseTranslations parses ECDICT's translation field into POS-grouped Chinese senses.
// ECDICT translations are newline-separated, each line prefixed with a POS tag:
//
//	"n. 世界, 领域\nvt. 使全球化"
//
// Lines without a recognizable POS prefix are discarded.
func parseChineseTranslations(translation string) map[entity.PartOfSpeech][]entity.LexemeSense {
	if translation == "" {
		return nil
	}

	result := make(map[entity.PartOfSpeech][]entity.LexemeSense)
	lines := strings.Split(translation, "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		tagged := parseTranslationLine(line)
		if tagged == nil {
			continue
		}

		result[tagged.POS] = append(result[tagged.POS], entity.LexemeSense{
			Language: entity.LanguageChinese,
			Gloss:    tagged.Gloss,
		})
	}

	return result
}

// parseTranslationLine extracts a POS tag and Chinese gloss from a single translation line.
// Expected format: "n. 世界, 领域" or "vt. 使全球化".
// Returns nil if no recognizable POS prefix is found.
func parseTranslationLine(line string) *posTaggedSense {
	// Find the POS prefix: everything before the first dot followed by space or end-of-string.
	dotIdx := strings.Index(line, ".")
	if dotIdx <= 0 {
		return nil
	}

	posRaw := strings.TrimSpace(line[:dotIdx])
	gloss := strings.TrimSpace(line[dotIdx+1:])

	// Reject if the prefix is too long (real POS prefixes are short: n, vt, vi, adj, adv, etc.)
	if len(posRaw) > 6 {
		return nil
	}

	pos, ok := entity.ParsePartOfSpeech(posRaw)
	if !ok {
		return nil
	}

	if gloss == "" {
		return nil
	}

	return &posTaggedSense{POS: pos, Gloss: gloss}
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

	if entry.Translation != "" {
		score += 40
	}
	if entry.Phonetic != "" {
		score += 20
	}
	if entry.POS != "" {
		score += 15
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
