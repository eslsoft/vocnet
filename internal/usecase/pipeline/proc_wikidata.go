package pipeline

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/util"
)

// WikidataProcessor fetches Wikidata QID + lexemes + forms.
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

	// Search for Wikidata entity
	entityResult, err := p.wikidata.SearchEntity(ctx, term, lang.Code())
	if err != nil {
		return nil, fmt.Errorf("wikidata search: %w", err)
	}

	if entityResult == nil || entityResult.QID == "" {
		return nil, fmt.Errorf("word not found in Wikidata: %s (non-standard vocabulary rejected)", term)
	}

	// Update lemma with QID
	updatedLemma := *pctx.Lemma
	updatedLemma.WikidataQID = entityResult.QID

	// Fetch lexemes
	lexemes, rawResp, err := p.wikidata.FetchLexemes(ctx, term, lang.Code())
	if err != nil {
		return nil, fmt.Errorf("fetch lexemes: %w", err)
	}

	if len(lexemes) == 0 {
		return nil, fmt.Errorf("no Wikidata lexemes found for: %s (QID: %s)", term, entityResult.QID)
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
			PartOfSpeech: lex.POS,
			EntryType:    entity.LexemeEntryTypeWord,
			Senses:       senses,
			Categories:   categories,
		})
	}

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
		LemmaUpdate:   &updatedLemma,
	}, nil
}

// mapGrammaticalFeaturesToFormType maps Wikidata grammatical features to LexemeFormType.
func mapGrammaticalFeaturesToFormType(features []string) entity.LexemeFormType {
	if len(features) == 0 {
		return entity.LexemeFormTypeLemma
	}

	hasThirdPerson := false
	hasSingular := false

	for _, qid := range features {
		switch qid {
		case "Q146786": // plural
			return entity.LexemeFormTypePlural
		case "Q1994301", "Q1230649": // past tense / simple past
			return entity.LexemeFormTypePast
		case "Q12612489", "Q1392475": // past participle
			return entity.LexemeFormTypePastParticiple
		case "Q10345583": // present participle / gerund
			return entity.LexemeFormTypePresentParticiple
		case "Q14169499": // comparative
			return entity.LexemeFormTypeComparative
		case "Q1817208": // superlative
			return entity.LexemeFormTypeSuperlative
		case "Q51929049", "Q51929074": // third person
			hasThirdPerson = true
		case "Q110786": // singular
			hasSingular = true
		case "Q3910936": // lemma/base form marker
			// informational only
		}
	}

	if hasThirdPerson && hasSingular {
		return entity.LexemeFormTypeThirdPersonSingular
	}

	return entity.LexemeFormTypeLemma
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
