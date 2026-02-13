# Data Evaluation and Adoption System - Usage Guide

## Overview

The data evaluation and adoption system provides a centralized mechanism to decide which data from multiple sources should be accepted into the pipeline based on quality scoring. **This system is now mandatory** for all pipeline operations.

## Quick Start

### Setting Up the Evaluator (Required)

The evaluator **must** be configured before running the pipeline:

```go
// Create evaluator with rule-based scorer
scorer := pipeline.NewRuleBasedScorer()
evaluator := pipeline.NewDataEvaluator(scorer, logger)

// Set in pipeline (REQUIRED)
pipeline.SetEvaluator(evaluator)
```

If the evaluator is not configured, the pipeline will return an error when `Run()` is called.

## How It Works

### 1. Field-Level Scoring

Each data field is scored independently on a 0-100 scale:

**Lexeme Scoring:**
- Base: 40 points
- +20 for valid POS
- +20 for having senses (definitions/glosses)
- +10 for having categories
- +10 for having ExternalID (+5 extra for Wikidata L-numbers)

**Form Scoring:**
- Base: 50 points
- +25 for having phonetics
- +25 for having syllables

**Lemma Field Scoring:**
- **Level**: CEFR levels scored inversely (A1=100, A2=90, B1=80, ..., C2=50)
- **Frequencies**: 10 points per corpus source (capped at 100)
- **Syllables**: 100 if present, 0 if absent

**Relation Scoring:**
- Base: 30 points
- +30 for resolved target (TargetLexemeID or TargetRef)
- +20 for sense-mapped
- +20 for valid strength (0-1 range)

### 2. Adoption Decisions

For each field:
1. **Empty field** → Always adopt new data
2. **Score comparison** → Adopt if new score > existing score
3. **Tie** → Use source trust rank as tiebreaker

**Source Trust Hierarchy:**
1. Wikidata (rank 5)
2. WordNet (rank 4)
3. LLM (rank 3)
4. ECDICT (rank 2)
5. ConceptNet (rank 1)
6. Others (rank 0)

### 3. Merge Strategies

**Lexemes:**
- Match by ExternalID
- If conflict → evaluate and merge fields intelligently
- Senses and categories are deduplicated and merged
- POS/SenseGloss adopted if existing is empty

**Forms:**
- Match by (Surface, FormType) key
- If conflict → enrich with better phonetics/syllables
- Phonetics merged with deduplication

**Lemma Updates:**
- Level: adopt if better score
- Frequencies: merge by corpus (overwrite if same corpus)
- Syllables: adopt if empty

## Examples

### Example 1: CEFRJ Level Adoption

```go
// Existing: Lemma{Level: "B1"}
// New: Lemma{Level: "A2"} from CEFRJ

// Scoring:
// - Existing: 80 (B1)
// - New: 90 (A2, more fundamental)

// Decision: Adopt A2 (new score > existing score)
```

### Example 2: Moby Syllables Enrichment

```go
// Existing: Form{Surface: "running", Syllables: []}
// New: Form{Surface: "running", Syllables: ["run", "ning"]} from Moby

// Scoring:
// - Existing: 50 (no syllables)
// - New: 75 (has syllables)

// Decision: Merge syllables into existing form
```

### Example 3: Wikidata vs ECDICT Lexeme

```go
// Existing: Lexeme{ExternalID: "L123", POS: "noun", Senses: [...]} from Wikidata
// New: Lexeme{POS: "noun", Senses: [...]} from ECDICT (no ExternalID)

// Scoring:
// - Existing: 90 (Wikidata + ExternalID + POS + senses)
// - New: 80 (no ExternalID)

// Decision: Keep existing Wikidata lexeme
```

## Extending the System

### Adding a Custom Scorer

Implement the `FieldScorer` interface:

```go
type MyCustomScorer struct{}

func (s *MyCustomScorer) ScoreLexeme(lex *entity.Lexeme, provider string) pipeline.FieldScore {
    // Your scoring logic
    return pipeline.FieldScore{
        Score:      75.0,
        Provider:   provider,
        Confidence: 0.9,
        Reason:     "custom scoring logic",
    }
}

// Implement other interface methods...
```

### LLM-Based Scorer (Future)

```go
type LLMFieldScorer struct {
    llmClient llm.Provider
}

func (s *LLMFieldScorer) ScoreLexeme(lex *entity.Lexeme, provider string) pipeline.FieldScore {
    // Call LLM to evaluate quality based on semantic context
    prompt := buildLexemeQualityPrompt(lex, provider)
    response := s.llmClient.Complete(ctx, prompt)

    return pipeline.FieldScore{
        Score:      response.Score,
        Provider:   provider,
        Confidence: response.Confidence,
        Reason:     response.Reasoning,
    }
}
```

## Debugging

### Viewing Adoption Decisions

The evaluator returns adoption decisions that can be logged:

```go
merged, decisions := evaluator.EvaluateAndMergeLexemes(existing, new, "wikidata")

for _, decision := range decisions {
    logger.Info("adoption decision",
        "should_adopt", decision.ShouldAdopt,
        "existing_score", decision.ExistingScore,
        "new_score", decision.NewScore,
        "reason", decision.Reason)
}
```

### Evidence Tracking

All adoption decisions are implicitly tracked via Evidence entities in the pipeline. Future enhancement could add explicit adoption logs to Evidence.

## Performance Considerations

- **Scoring overhead**: O(n) for each field type, typically < 5% of total pipeline time
- **Memory**: Minimal overhead, only stores scores during evaluation
- **Scalability**: Scales linearly with data volume
- **Required**: The evaluator is now mandatory - there is no legacy fallback

## Migration from Legacy System

### Breaking Change

**The legacy merge behavior has been removed.** The evaluator is now mandatory for all pipeline operations.

### Migration Required

If your code was previously running the pipeline without an evaluator, you must now:

1. Create a scorer (e.g., `NewRuleBasedScorer()`)
2. Create an evaluator with the scorer
3. Call `pipeline.SetEvaluator(evaluator)` before `pipeline.Run()`

**Before:**
```go
pipeline := NewPipeline(...)
// Could run directly without evaluator
pipeline.Run(ctx, jobID, term, language, tier, opts)
```

**After:**
```go
pipeline := NewPipeline(...)

// REQUIRED: Set evaluator
scorer := pipeline.NewRuleBasedScorer()
evaluator := pipeline.NewDataEvaluator(scorer, logger)
pipeline.SetEvaluator(evaluator)

// Now can run
pipeline.Run(ctx, jobID, term, language, tier, opts)
```

## Troubleshooting

### Issue: Data not being adopted

**Check:**
1. Is evaluator enabled? (`pipeline.SetEvaluator()`)
2. Is provider name set in ProcessResult?
3. Are scores being computed correctly? (add debug logging)

### Issue: Wrong data being adopted

**Check:**
1. Scoring weights - are they tuned correctly for your use case?
2. Source trust rank - should provider rank be adjusted?
3. Custom scorer logic - review implementation

## References

- Design Document: [`docs/design/data-evaluation-adoption.md`](../design/data-evaluation-adoption.md)
- Quality Scoring: [`internal/usecase/pipeline/quality_calculator.go`](../../internal/usecase/pipeline/quality_calculator.go)
- Implementation: [`internal/usecase/pipeline/data_evaluator.go`](../../internal/usecase/pipeline/data_evaluator.go)
