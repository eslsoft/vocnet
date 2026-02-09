# Pipeline Stage Data Sources Matrix

This document describes, stage by stage, which data source each processor uses and what data it extracts into the pipeline context.

## Scope and Source of Truth

- Stage wiring source: `cmd/serve.go` (`buildPipelineWorkerPool`)
- Processor contracts: `internal/usecase/pipeline/*.go`
- This document reflects the current runtime pipeline order:
  1. `discovery`
  2. `lexical`
  3. `relational`
  4. `intellectual`
  5. `synthesis`

## Stage 1: Discovery

### Processor: `wikidata` (`NewWikidataProcessor`)

- Data source: Wikidata local lexeme index (`internal/adapter/provider/wikidata`)
- Input query: `FetchLexemes(term, language)`
- Extracted data:
  - Lexeme-level:
    - `ExternalID` (`LexemeID`, e.g. `L123`)
    - `Language`
    - `PartOfSpeech` (mapped to internal enum `entity.PartOfSpeech`)
    - `Senses` (from `sense.Glosses` language map)
    - `SenseGloss` (picked from senses)
    - `Categories` (inferred from senses)
  - Form-level:
    - `Surface` (form representation)
    - `FormType` (mapped from Wikidata grammatical feature QIDs)
    - `IsIrregular`
    - `Phonetics` (`IPA`, `Dialect`)
  - Global form behavior:
    - Ensures the queried surface form is present as a lemma form (`ensureSurfaceForm`)
  - Evidence:
    - `Provider=wikidata`, `Phase=discovery`
    - `Content=rawResp` from provider
    - `SchemaVersion=wikidata-2025`
- Key quality gate:
  - Rejects low-confidence multi-candidate matches (`match_score <= 40` and `candidate_count > 1`)
  - Rejects unmapped/unknown POS (including unknown Wikidata POS QIDs)

### Processor: `category-infer` (`NewCategoryInferProcessor`)

- Data source: None (derived from already collected lexeme senses)
- Extracted/derived data:
  - Additional `Lexeme.Categories` from `InferCategoriesFromSenses`
- Evidence:
  - None (no external fetch)

## Stage 2: Lexical

### Processor: `cefrj` (`NewCEFRJProcessor`)

- Data source: CEFR-J CSVs (`internal/adapter/provider/cefrj`)
  - Base: `cefrj-vocabulary-profile-1.5.csv`
  - Supplement: `octanove-vocabulary-profile-c1c2-1.0.csv`
- Input query: lookup by term (case-insensitive; CEFR-J headword variants split by `/`)
- Extracted data:
  - Lemma enrichment:
    - `Lemma.Level` (CEFR level)
    - Rule: when multiple CEFR-J rows match a lemma, choose the minimum CEFR level by order `A1 < A2 < B1 < B2 < C1 < C2`
    - If lemma already has a level, processor keeps the lower one between existing and CEFR-J
  - Evidence content fields:
    - `headword`, `min_level`, `levels_by_pos`, `matched_forms`
    - `Provider=cefrj`, `Phase=lexical`, `SchemaVersion=cefrj-1.5+c1c2-1.0`

### Processor: `ecdict` (`NewECDICTProcessor`)

- Data source: ECDICT SQLite (`internal/adapter/provider/ecdict`)
- Input query: `Lookup(term)`
- Extracted data:
  - Lexeme enrichment:
    - `Senses` from:
      - `definition` -> English senses
      - `translation` -> Chinese senses
    - `PartOfSpeech` from `pos` (mapped to internal enum `entity.PartOfSpeech`)
    - `Categories` from `tags` (domain categories)
    - `Completeness` (scored from available fields)
  - Lemma enrichment:
    - `Frequencies`:
      - `bnc` -> corpus `bnc`
      - `frq` -> corpus `frq`
  - Form enrichment:
    - Lemma form phonetic from `phonetic` (dialect hardcoded to `en-GB`)
  - Evidence content fields:
    - `word`, `phonetic`, `definition`, `translation`, `pos`, `tags`
    - `bnc`, `frq`, `collins`, `oxford`, `exchange`
    - `Provider=ecdict`, `Phase=lexical`, `SchemaVersion=ecdict-1.0`
- Key quality gate:
  - Rejects unmapped/unknown POS from ECDICT `pos`

### Processor: `moby` (`NewMobyProcessor`)

- Data source: Moby hyphenation file (`internal/adapter/provider/moby`)
- Input query: lookup each existing form surface
- Extracted data:
  - `LemmaForm.Syllables`
- Evidence:
  - None (no raw evidence record emitted)

## Stage 3: Relational

### Processor: `conceptnet` (`NewConceptNetProcessor`)

- Data source: ConceptNet local index (`internal/adapter/provider/conceptnet`)
- Input query: `FetchRelations(term, language)`
- Extracted data:
  - Semantic relations (`entity.SemanticRelation`):
    - `RelationType`
    - `TargetTerm` (opposite side of current term in edge)
    - `TargetRef` (`conceptnet://{lang}/{term}`)
    - `Provider=conceptnet`
    - `Strength` (normalized from ConceptNet `weight`)
    - `SenseMapped=false` (for later mapping)
  - Evidence:
    - `Provider=conceptnet`, `Phase=relational`
    - `Content=rawResp`, `SchemaVersion=conceptnet-5.7`
- Key filter:
  - Drops low-signal edges where `weight <= 1.0`

### Processor: `wikidata_relations` (`NewWikidataRelationProcessor`)

- Data source: Wikidata form lookup (`FetchLexemesByForm`)
- Input query:
  - Candidate lookup terms from: requested term + known forms (max 8, deduped)
- Extracted data:
  - Cross-lexeme neighborhood relations:
    - `RelationType=ASSOCIATION`
    - `TargetRef=wikidata://lexeme/{LexemeID}`
    - `TargetTerm` (best form surface or fallback)
    - `Provider=wikidata`
    - `Strength=0.9`
    - `SenseMapped=true`
  - Evidence content:
    - `source=wikidata-lexeme-neighborhood`
    - `term`, `language`, `lookup_terms`, `lookup_terms_queried`, `relations_found`
    - `SchemaVersion=wikidata-relations-v1`
- Key constraint:
  - Only keeps targets already present in current context lexeme IDs (avoid noisy expansion)

### Processor: `wordnet` (`NewWordNetProcessor`)

- Data source: WordNet dict files (`internal/adapter/provider/wordnet`)
- Input query:
  - POS candidates from current lexemes (plus fallback noun/verb/adjective/adverb)
  - `LookupSynsets(term, pos)` and hypernym traversal
- Extracted data:
  - Semantic relations:
    - Hypernym chain relations:
      - `RelationType=HYPERNYM`
      - `TargetRef=wordnet://synset/{offset}`
      - `Provider=wordnet`, `Strength=1.0`, `SenseMapped=true`
    - Other mapped pointer-symbol relations (via `MapWordNetRelation`)
  - Evidence content:
    - `word`, `pos_candidates`
    - `synsets`: `{offset,pos,words,gloss,relations}`
    - `SchemaVersion=wordnet-3.1`

## Stage 4: Intellectual

This stage uses the LLM provider (`internal/adapter/provider/llm`), not offline lexical databases.

### Processor: `sense_mapping` (`NewSenseMappingProcessor`)

- Data source: LLM completion (`JSONMode`)
- Input payload:
  - Unmapped relations (`SenseMapped=false`)
  - Current lexeme summaries (`external_id`, `pos`, `sense_gloss`)
- Extracted/updated data:
  - In-place updates of existing relations:
    - set `SourceExternalID` to mapped lexeme ID
    - set `SenseMapped=true`
  - Evidence:
    - `processor=sense_mapping`, `model=llm`, `cached`, `token_count`, `mapped_count`
    - `Provider=llm`, `Phase=intellectual`

### Processor: `enrichment` (`NewEnrichmentProcessor`)

- Data source: LLM completion (`JSONMode`)
- Input payload:
  - Incomplete lexemes (missing gloss/senses/examples)
- Extracted/updated data:
  - Lexeme updates:
    - fill `SenseGloss` if empty
    - merge new `Senses` (English/Chinese and examples)
  - Evidence:
    - `processor=enrichment`, `model=llm`, `cached`, `token_count`, `enriched_count`
    - `Provider=llm`, `Phase=intellectual`

### Processor: `scoring` (`NewScoringProcessor`)

- Data source: LLM completion (`JSONMode`)
- Input payload:
  - Current relations (`target_term`, `relation_type`, `provider`, `current_strength`)
- Extracted/updated data:
  - In-place relation strength updates:
    - set `Strength` to LLM score clamped to `[0,1]`
  - Evidence:
    - `processor=scoring`, `model=llm`, `cached`, `token_count`, `scored_count`
    - `Provider=llm`, `Phase=intellectual`

## Stage 5: Synthesis

### Processor: `snapshot` (`NewSnapshotProcessor`)

- Data source: None (pure synthesis from `PipelineContext`)
- Extracted/derived data:
  - Builds materialized `WordSnapshot`:
    - Snapshot lexemes (`POS`, senses, forms, phonetics)
    - Snapshot relations (type/target/provider/strength/mapped/resolved)
    - Quality scores (`QScore`, completeness/depth/density/validity)
- Evidence:
  - None (snapshot entity is emitted, not raw evidence)

## Cross-Stage POS Validation

- Pipeline performs strict POS validation on `PipelineContext.Lexemes`.
- Any lexeme with POS outside internal enum `entity.PartOfSpeech` fails the pipeline run.
- This serves as a future-proof guardrail so newly introduced data-source POS values cannot silently pass through.

## Source-to-Stage Quick Matrix

| Source | Discovery | Lexical | Relational | Intellectual | Synthesis |
|---|---|---|---|---|---|
| Wikidata | ✅ | ❌ | ✅ | ❌ | ❌ |
| ECDICT | ❌ | ✅ | ❌ | ❌ | ❌ |
| CEFRJ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Moby | ❌ | ✅ | ❌ | ❌ | ❌ |
| ConceptNet | ❌ | ❌ | ✅ | ❌ | ❌ |
| WordNet | ❌ | ❌ | ✅ | ❌ | ❌ |
| LLM | ❌ | ❌ | ❌ | ✅ | ❌ |
| Internal context only | ✅ | ❌ | ❌ | ❌ | ✅ |

`✅` details:
- Wikidata: discovery=`wikidata`; relational=`wikidata_relations`
- ECDICT: lexical=`ecdict`
- CEFRJ: lexical=`cefrj`
- Moby: lexical=`moby`
- ConceptNet: relational=`conceptnet`
- WordNet: relational=`wordnet`
- LLM: intellectual=`sense_mapping`, `enrichment`, `scoring`
- Internal context only: discovery=`category-infer`; synthesis=`snapshot`

## Update Rule (Must Keep in Sync)

When any of the following changes, update this document in the same PR:

- Stage order or stage membership in `cmd/serve.go`
- Added/removed/replaced processor in any stage
- Processor extraction fields, filters, scoring/mapping rules
- Raw evidence payload structure or `SchemaVersion`
- Data source provider API changes affecting extracted outputs

Recommended PR checklist item:

- [ ] Updated `docs/design/pipeline-stage-data-sources.md` to match pipeline behavior
