package pipeline

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/util"
)

// WikidataProcessor fetches lexemes + forms from Wikidata.
type WikidataProcessor struct {
	wikidata provider.WikidataProvider
	logger   *slog.Logger
}

// NewWikidataProcessor creates a new WikidataProcessor.
func NewWikidataProcessor(wikidata provider.WikidataProvider, logger *slog.Logger) *WikidataProcessor {
	return &WikidataProcessor{wikidata: wikidata, logger: logger}
}

func (p *WikidataProcessor) Name() string { return "wikidata" }

func (p *WikidataProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
	if p.wikidata == nil {
		return nil, &ErrProcessorSkipped{Reason: "wikidata not available"}
	}

	term := pctx.Term
	lang := pctx.Language

	// Fetch lexemes.
	lexemes, rawResp, err := p.wikidata.FetchLexemes(ctx, term, lang.Code())
	if err != nil {
		return nil, fmt.Errorf("fetch lexemes: %w", err)
	}
	if rejectLowConfidenceLexemeMatch(rawResp) {
		return nil, fmt.Errorf("low-confidence lexeme match rejected for: %s", term)
	}

	if len(lexemes) == 0 {
		return nil, fmt.Errorf("word not found in Wikidata: %s (non-standard vocabulary rejected)", term)
	}

	// Create evidence
	evidence := &entity.RawEvidence{
		Provider:      "wikidata",
		Phase:         int32(entity.PhaseDiscovery),
		Content:       rawResp,
		SchemaVersion: "wikidata-2025",
		FetchedAt:     time.Now(),
	}

	// Convert provider lexemes to entity lexemes
	entityLexemes := make([]*entity.Lexeme, 0, len(lexemes))
	allForms := make([]*entity.LemmaForm, 0)
	formsByLexeme := make(map[string][]*entity.LemmaForm)

	for _, lex := range lexemes {
		pos, err := parsePOSFromSource("wikidata", lex.POS)
		if err != nil {
			return nil, fmt.Errorf("wikidata lexeme %s pos mapping failed: %w", lex.LexemeID, err)
		}

		senses := make([]entity.LexemeSense, 0, len(lex.Senses))
		for _, s := range lex.Senses {
			for sLang, gloss := range s.Glosses {
				senses = append(senses, entity.LexemeSense{
					Language: entity.ParseLanguage(sLang),
					Gloss:    gloss,
				})
			}
		}

		// Extract forms
		lexemeForms := make([]*entity.LemmaForm, 0)
		for _, form := range lex.Forms {
			if form.Representation == "" {
				continue
			}

			phonetics := make([]entity.Phonetic, 0, len(form.Phonetics))
			for _, ph := range form.Phonetics {
				dialect := ph.Dialect
				if dialect == "" {
					dialect = defaultDialect(lang)
				}
				phonetics = append(phonetics, entity.Phonetic{
					IPA:     ph.IPA,
					Dialect: dialect,
				})
			}

			formType := mapGrammaticalFeaturesToFormType(form.Features)
			isIrregular := util.IsIrregularForm(term, form.Representation, formType)

			p.logger.Debug("wikidata form",
				"surface", form.Representation,
				"features", form.Features,
				"formType", formType,
				"phonetics", len(phonetics),
				"irregular", isIrregular,
				"lexeme", lex.LexemeID)

			formEntity := &entity.LemmaForm{
				Surface:     form.Representation,
				FormType:    formType,
				IsIrregular: isIrregular,
				Phonetics:   phonetics,
			}
			lexemeForms = append(lexemeForms, formEntity)
			allForms = append(allForms, formEntity)
		}

		formsByLexeme[lex.LexemeID] = lexemeForms

		// Infer categories from senses
		categories := InferCategoriesFromSenses(senses)

		entityLexemes = append(entityLexemes, &entity.Lexeme{
			ExternalID:   lex.LexemeID,
			Language:     entity.ParseLanguage(lex.Language),
			PartOfSpeech: pos,
			EntryType:    entity.LexemeEntryTypeWord,
			SenseGloss:   pickSenseGloss(senses),
			Senses:       senses,
			Categories:   categories,
		})
	}

	// Preserve the requested spelling variant at lemma level.
	// This guarantees entries like "favourite"/"favorite" are both queryable via lemma forms.
	allForms = ensureSurfaceForm(allForms, term)

	p.logger.Info("wikidata processor completed",
		"term", term,
		"lexemes", len(entityLexemes),
		"forms", len(allForms))

	return &ProcessResult{
		Status:        ProcessStatusExecuted,
		Evidence:      []*entity.RawEvidence{evidence},
		Lexemes:       entityLexemes,
		Forms:         allForms,
		FormsByLexeme: formsByLexeme,
	}, nil
}

func ensureSurfaceForm(forms []*entity.LemmaForm, surface string) []*entity.LemmaForm {
	surface = strings.TrimSpace(surface)
	if surface == "" {
		return forms
	}

	normalized := strings.ToLower(surface)
	for _, f := range forms {
		if f == nil {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(f.Surface), surface) && f.FormType == entity.FormTypeLemma {
			return forms
		}
	}

	return append(forms, &entity.LemmaForm{
		Surface:    surface,
		Normalized: normalized,
		FormType:   entity.FormTypeLemma,
	})
}

// mapGrammaticalFeaturesToFormType maps Wikidata grammatical features to FormType.
func mapGrammaticalFeaturesToFormType(features []string) entity.FormType {
	if len(features) == 0 {
		return entity.FormTypeLemma
	}

	hasThirdPerson := false
	hasSingular := false

	for _, qid := range features {
		switch qid {
		case "Q146786": // plural
			return entity.FormTypePlural
		case "Q1994301", "Q1230649": // past tense / simple past
			return entity.FormTypePast
		case "Q12612489", "Q1392475": // past participle
			return entity.FormTypePastParticiple
		case "Q10345583": // present participle / gerund
			return entity.FormTypePresentParticiple
		case "Q14169499": // comparative
			return entity.FormTypeComparative
		case "Q1817208": // superlative
			return entity.FormTypeSuperlative
		case "Q51929049", "Q51929074": // third person
			hasThirdPerson = true
		case "Q110786": // singular
			hasSingular = true
		case "Q3910936": // lemma/base form marker
			// informational only
		}
	}

	if hasThirdPerson && hasSingular {
		return entity.FormTypeThirdPersonSingular
	}

	return entity.FormTypeLemma
}

// defaultDialect returns the default BCP 47 dialect tag for a language
// when the data source does not specify one.
func defaultDialect(lang entity.Language) string {
	switch lang {
	case entity.LanguageEnglish:
		return "en-GB"
	case entity.LanguageChinese:
		return "zh-CN"
	default:
		return lang.Code()
	}
}

func rejectLowConfidenceLexemeMatch(evidence map[string]any) bool {
	if len(evidence) == 0 {
		return false
	}
	score, ok := evidence["match_score"]
	if !ok {
		return false
	}
	scoreNum, ok := score.(int)
	if !ok {
		if f, okf := score.(float64); okf {
			scoreNum = int(f)
			ok = true
		}
	}
	if !ok {
		return false
	}
	if scoreNum > 40 {
		return false
	}
	countAny, ok := evidence["candidate_count"]
	if !ok {
		return false
	}
	switch v := countAny.(type) {
	case int:
		return v > 1
	case int32:
		return v > 1
	case int64:
		return v > 1
	case float64:
		return int(v) > 1
	default:
		return false
	}
}
