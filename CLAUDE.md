# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vocnet is an open-source vocabulary network management platform that serves as a centralized vocabulary data hub. It provides:

- Multi-dimensional mastery tracking (listen, read, spell, pronounce) with 0-5 level granularity
- FSRS (Free Spaced Repetition Scheduler) algorithm for intelligent review scheduling
- ConnectRPC-based API with auto-generated SDKs for all platforms
- Support for SQLite (default) and PostgreSQL databases

The project targets both language learners (who use it to track and review vocabulary) and app developers (who integrate it as a vocabulary management backend).

## Architecture

### Clean Architecture Layers

The codebase follows Clean Architecture with strict dependency rules:

```
internal/
├── entity/          # Core domain models (no external dependencies)
├── repository/      # Repository interfaces (defined by usecases)
├── usecase/         # Business logic (depends on entity + repository interfaces)
├── adapter/         # Implementation of external interfaces
│   ├── connectrpc/  # gRPC/ConnectRPC handlers (thin layer, validation only)
│   ├── repository/  # Repository implementations using Ent ORM
│   └── mapping/     # Entity ↔ Protobuf conversions
├── infrastructure/  # External concerns (DB, auth, server)
│   ├── database/    # Ent ORM schemas and client
│   │   └── entschema/ # Ent schema definitions
│   ├── auth/        # JWT validation and interceptors
│   ├── usertime/    # User timezone handling
│   └── server/      # Server setup
└── app/             # Dependency injection (Wire)
```

**Critical Rules:**
- Inner layers (entity, usecase) MUST NOT import outer layers (adapter, infrastructure)
- Repository interfaces are defined in `internal/repository/` and consumed by usecases
- Repository implementations live in `internal/adapter/repository/`
- Business logic belongs in usecases; ConnectRPC handlers only validate and delegate

### Key Domain Concepts

#### LearnedWord
The central entity representing a user's vocabulary entry (`internal/entity/learned_word.go`). Each word tracks:
- **Term**: Lemma for regular words, or the original form for irregular words (stored with original case, e.g., "Hello", "iPhone", "Polish")
- **Normal**: Auto-generated lowercase form of Term for case-insensitive querying (internal field, e.g., "hello", "iphone", "polish")
- **Case Handling**:
  - Storage: Term preserves original case; Normal is automatically set to lowercase in `Normalize()` method
  - Uniqueness: Based on `(user_id, term, language)` - case-sensitive (user can store both "Polish" and "polish")
  - Querying: Case-insensitive using `normal` field - "Hello" and "hello" both match stored "Hello"
  - Priority: Exact case match prioritized over other matches with same normal form
  - Display: Always shows original Term case to user
- **MasteryBreakdown**: Four-dimensional mastery (Listen, Read, Spell, Pronounce) + calculated Overall score
  - Scores are 0-5 integers stored as centpoints (0-500 range internally)
  - Overall is calculated via weighted formula: `0.6 * receptive + 0.4 * productive`
  - Receptive = (Read + Listen) / 2
  - Productive = 0.3 * Spell + 0.7 * Pronounce
- **ReviewTiming**: FSRS state (LastReviewAt, NextReviewAt, IntervalDays, FailCount, Reps)
- **Relations**: Vocabulary network connections (synonyms, antonyms, derived words)
- **Contexts**: Sentences where the user encountered the word

#### FSRS Integration
The project uses FSRS-4.5 for spaced repetition (`internal/usecase/spaced_repetition_fsrs.go`).

**Important Design Decision**: FSRS parameters (stability, difficulty, state) are NOT stored in the database. Instead, they are dynamically calculated from mastery data on each review. This:
- Eliminates redundant storage
- Derives FSRS state from the canonical mastery breakdown
- Uses mastery level to infer FSRS state (New/Learning/Review/Relearning)

Review interval calculation happens in `CalculateNextReview()` which:
1. Builds FSRS Card from mastery data
2. Maps accuracy score (0-1) to FSRS rating (1-4)
3. Calls FSRS algorithm
4. Returns updated ReviewTiming

#### Lemma vs Lexeme
- **Lemma** (`internal/entity/lemma.go`): Dictionary headword (e.g., "run")
- **Lexeme** (`internal/entity/lexeme.go`): Wikidata lexeme with specific grammatical sense
- **LexemeForm**: Inflected forms (e.g., "runs", "running", "ran")

Users primarily interact with lemmas. Lexemes provide linguistic enrichment (definitions, categories, forms).

### Database Schema (Ent ORM)

Schemas are defined in `internal/infrastructure/database/entschema/`:
- `learned_word.go`: User vocabulary entries
- `lemma.go`: Dictionary headwords
- `lexeme.go`: Wikidata lexemes
- `lexeme_form.go`: Inflected forms
- `review_plan.go`: User review sessions
- `daily_stats.go`: Daily learning statistics
- `wordbook.go`: Predefined word lists (CET4, IELTS, etc.)

**After modifying schemas**, regenerate Ent client:
```bash
make ent-generate
```

### API (ConnectRPC)

Proto definitions are in `api/proto/`:
- `dict/`: Dictionary services (words, lemmas, lexemes)
- `learning/`: Learning services (learned words, flashcards, reviews)
- `wordbook/`: Wordbook services (preset word lists)
- `common/`: Shared types (enums, pagination)

**Proto Organization Rules (Required):**
- Keep service contract files focused on RPCs and request/response messages. Do not embed large reusable domain message sets directly in `*_service.proto`.

**After modifying `.proto` files**, regenerate code:
```bash
make generate
```

This regenerates:
- Go protobuf and ConnectRPC code (`pkg/api/`)
- Ent client
- Mocks
- Wire dependency injection

## Common Commands

### Development

```bash
# Setup development environment (install tools + generate code)
make setup

# Start database (PostgreSQL in Docker)
make db-up

# Run database migrations
make migrate

# Run ConnectRPC server (supports both gRPC and HTTP protocols on :8080)
make run
# or with custom DB
DATABASE_URL=postgres://user:pass@localhost:5432/vocnet make run

# Start full dev environment (DB + server)
make dev
```

### Testing

```bash
# Run all tests (excludes scripts/)
make test

# Run tests with HTML coverage report
make test-coverage

# Run tests for specific package
go test -v ./internal/usecase/...

# Run single test
go test -v -run TestLearnedWordUsecase_UpdateMastery ./internal/usecase/

# Run pipeline quality integration tests (all words in default wordbooks)
make test-quality

# Run quality tests for ALL wordbooks (all words, comprehensive)
make test-quality-all

# Run quality tests with reduced sample size (faster)
make test-quality-fast

# Update quality baseline from latest test results
make quality-baseline
```

**Testing Conventions:**
- UseCase tests use mocked repositories (`internal/mocks/`)
- Repository tests use real database (require `DATABASE_URL`)
- Integration tests use `//go:build integration` tag
- Table-driven tests preferred
- Test files named `*_test.go` alongside implementation

**Pipeline Quality Testing:**
- Integration tests validate data quality for all built-in wordbooks
- Tests run in parallel for performance
- Generate detailed reports in `reports/quality/`
- Compare against baseline in `testdata/baselines/quality/baseline.json`
- See `docs/guides/pipeline-quality-testing.md` for full documentation

Quick quality test workflow:
```bash
# Run quick quality check (10 words/book)
./scripts/quality-test.sh quick

# Run default quality test (all words, matches make test-quality)
./scripts/quality-test.sh default

# Run medium sample test (30 words/book)
./scripts/quality-test.sh sample

# Run full quality test and update baseline
./scripts/quality-test.sh all
./scripts/quality-test.sh baseline

# View quality report
./scripts/quality-test.sh report

# Compare with baseline
./scripts/quality-test.sh compare
```

### Code Generation

```bash
# Generate all (protobuf + ent + mocks)
make generate

# Generate only Ent client
make ent-generate

# Format code
make fmt

# Lint code
make lint
```

**Mocks:**
- Auto-generated via `go:generate` directives in interface files
- Located in `internal/mocks/`
- Use `github.com/golang/mock/gomock`
- After changing interfaces, run `make generate`

### Building

```bash
# Build binary to bin/vocnet
make build

# Build Docker image
make docker-build

# Run Docker container
make docker-run
```

### Database

```bash
# SQLite (default)
DATABASE_URL=file:./data/vocnet.db go run . serve

# PostgreSQL
make db-up  # Start container
DATABASE_URL=postgres://postgres:postgres@localhost:5432/vocnet go run . serve

# Stop database
make db-down
```

### Protobuf

```bash
# Lint proto files
make buf-lint

# Check for breaking changes against main
make buf-breaking

# Format proto files
make buf-format
```

## Configuration

Configuration via environment variables (see `.env.example`):

- `DATABASE_URL`: Database connection string (SQLite or PostgreSQL)
- `SERVER_GRPC_PORT`: gRPC server port (default: 9090)
- `SERVER_HTTP_PORT`: ConnectRPC HTTP port (default: 8080)
- `AUTH_JWKS_URL`: JWT JWKS endpoint for authentication (Supabase format)
- `LOG_LEVEL`: Logging level (debug, info, warn, error)

### LLM Enrichment (Optional)

The pipeline includes an optional LLM enrichment phase that intelligently fills data gaps:

- `LLM_BASE_URL`: OpenAI-compatible API endpoint (default: `https://api.openai.com/v1`)
- `LLM_API_KEY`: API key for LLM provider (required to enable enrichment)
- `LLM_MODEL`: Model name (default: `gpt-4o-mini`)

**How it works:**
1. After Collection phase, the pipeline analyzes what data is missing
2. If gaps are detected (incomplete lexemes, unmapped relations, etc.), LLM is called
3. LLM-generated data is added to the pipeline context as Evidence
4. In Evaluation phase, LLM data is scored alongside other sources (Wikidata, ECDICT, etc.)
5. In Integration phase, the best-quality fragments are selected (may or may not be from LLM)

**Cost optimization:**
- Only runs if `LLM_API_KEY` is configured
- Skips LLM call if no gaps detected
- Uses transparent response caching via `DistillCacheRepository`

Load `.env` file automatically on startup.

## Pipeline Data Management

The semantic distillation pipeline requires five data sources: ConceptNet, ECDICT, WordNet, Moby, and Wikidata. The `pipeline` command provides tools to manage these data sources.

All data sources use local SQLite databases for efficient querying. The project uses `modernc.org/sqlite` (CGO-free) as the SQLite driver.

### Pipeline Commands

```bash
# Process a single word through the pipeline
go run . pipeline process <term> [--language en] [--tier 2]

# Check pipeline status for a word
go run . pipeline status <term> [--language en]

# View word snapshot
go run . pipeline snapshot <term> [--language en]

# Check data source availability
go run . pipeline source list

# Download all missing data sources
go run . pipeline source download

# Download specific data source
go run . pipeline source download conceptnet
go run . pipeline source download ecdict
go run . pipeline source download wordnet
go run . pipeline source download moby
go run . pipeline source download wikidata

# Quick setup: download all data sources
make pipeline-setup
```

### Data Source Configuration

Configure the pipeline data directory in `.env`:

```bash
# Pipeline system data directory
# Data sources are fixed under: ${PIPELINE_DATA_DIR}/datasources/
PIPELINE_DATA_DIR=./data

# Auto-download missing sources (default: true)
PIPELINE_AUTO_DOWNLOAD=true

# Cache directory for downloads (default: system cache dir)
# PIPELINE_CACHE_DIR=~/.cache/vocnet

# Contrib sources (external data sources via JSON-RPC over stdio)
PIPELINE_CONTRIB_DIR=./contrib/sources
PIPELINE_CONTRIB_LIST=ecdict,conceptnet,wordnet
```

Data sources are stored under subdirectories of `PIPELINE_DATA_DIR`:
- `conceptnet/conceptnet-assertions-5.7.0.csv` (+ `.idx.db` SQLite index)
- `ecdict/ecdict.db`
- `wordnet/`
- `moby/mhyph.txt`
- `wikidata/lexemes.json` (+ `.idx.db` SQLite index)

### Pipeline Source Architecture

The pipeline uses a unified `SourceProvider` interface (`internal/repository/source_provider.go`). Sources are categorized as:

- **Built-in** (compiled into binary): Wikidata, Moby, CEFR-J
- **Contrib** (external processes via JSON-RPC over stdio): ECDICT, ConceptNet, WordNet (`contrib/sources/`)
- **Specialized processors** (unique business logic, not SourceProvider-based): CategoryInfer, SenseMapping, Enrichment, Scoring, Snapshot

Key files:
- Interface: `internal/repository/source_provider.go`
- Generic processor: `internal/usecase/pipeline/generic_processor.go`
- Source registry: `internal/usecase/pipeline/source_registry.go`
- Contrib bridge: `internal/adapter/provider/contrib/process_provider.go`
- Contrib protocol: `internal/adapter/provider/contrib/protocol.go`
- Stage wiring: `cmd/serve.go` (`buildPipelineWorkerPool`)

### Data Evaluation and Adoption System

The pipeline includes a **mandatory** data evaluation system that determines which data from multiple sources should be adopted based on quality scoring.

**Key Concepts:**
- **Field-level scoring**: Each data field (lexemes, forms, lemma metadata, relations) is scored independently (0-100 scale)
- **Adoption decisions**: Data is adopted if field is empty, or if new score > existing score
- **Source trust hierarchy**: Used as tiebreaker when scores are equal (Wikidata > WordNet > LLM > ECDICT > ConceptNet)

**Scoring Rules (RuleBasedScorer):**
- Lexemes: scored on POS validity, senses, categories, ExternalID presence
- Forms: scored on phonetics and syllables presence
- Lemma Level: CEFR levels scored inversely (A1=100, A2=90, ..., C2=50)
- Relations: scored on target resolution, sense-mapping, strength validity

**Architecture:**
- Interface: `internal/usecase/pipeline/field_scorer.go` (extensible for LLM-based scoring)
- Built-in scorer: `internal/usecase/pipeline/rule_based_scorer.go`
- Evaluator: `internal/usecase/pipeline/data_evaluator.go` (orchestrates evaluation)
- Integration: `internal/usecase/pipeline/processor.go` (`PipelineContext.AccumulateWithProvider`)

**Usage (required):**
```go
// Create evaluator
scorer := pipeline.NewRuleBasedScorer()
evaluator := pipeline.NewDataEvaluator(scorer, logger)

// Pass to pipeline constructor
pipeline := pipeline.NewPipeline(
    stages,
    validator,
    persistence,
    stageRepo,
    snapshotRepo,
    lemmaRepo,
    lexemeRepo,
    evaluator,  // Required parameter
    logger,
)
```

The evaluator is a required constructor parameter.

**Documentation:**
- Design: `docs/design/data-evaluation-adoption.md`
- Usage guide: `docs/guides/data-evaluation-adoption-guide.md`
- Tests: `internal/usecase/pipeline/data_evaluation_test.go`

### Data Source Details

- **ConceptNet**: Downloaded from `https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz` (~350MB compressed, ~1.5GB uncompressed). A SQLite index is built automatically on first use.
- **ECDICT**: Downloaded from `https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip`
- **WordNet**: Downloaded from `https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz`
- **Moby**: Downloaded from `https://raw.githubusercontent.com/words/moby/master/words.txt` (Moby Hyphenation data for syllable parsing)
- **Wikidata**: Downloaded from `https://dumps.wikimedia.org/wikidatawiki/entities/latest-lexemes.json.bz2` (~420MB compressed, ~4GB uncompressed). Contains lexeme data (senses, forms, IPA). A SQLite index is built automatically on first use.

Downloads are cached in `~/.cache/vocnet/` (or `$PIPELINE_CACHE_DIR`) to avoid re-downloading.

### Auto-Download

Auto-download is enabled by default. To explicitly enable it:

```bash
# One-time for current command
PIPELINE_AUTO_DOWNLOAD=true go run . pipeline process hello

# Permanently in .env
echo "PIPELINE_AUTO_DOWNLOAD=true" >> .env
```

When auto-download is disabled and data is missing, the pipeline will show helpful error messages with download instructions.

### Pipeline Stage Documentation Sync (Required)

The stage-to-source extraction matrix is documented in:

- `docs/design/pipeline-stage-data-sources.md`

When modifying any pipeline behavior below, update that document in the same PR:

- Stage order or processor composition in `cmd/serve.go`
- Processor extraction logic in `internal/usecase/pipeline/`
- Evidence payload/schema versions
- Data source/provider mapping changes (Wikidata, ECDICT, WordNet, Moby, ConceptNet, LLM)

## Import Scripts

Dictionary initialization tool lives in `hack/dictinit/`:

- `cmd/dictinit/main.go`: CLI entry point
- `internal/dictinit/pipeline/main.go`: Pipeline configuration
- `internal/dictinit/sources/wikidata/wikidata_importer.go`: Wikidata lexeme ingestion
- `internal/dictinit/sources/ecdict/ecdict_enricher.go`: ECDICT enrichment parsing
- `internal/dictinit/util/irregular_detector.go`: Detect irregular verb forms

Run via CLI commands:
```bash
go run ./hack/dictinit/cmd/dictinit --help
```

Reports are saved to `reports/` directory.

## Authentication

JWT-based authentication using Supabase JWKS:
- JWT validator in `internal/infrastructure/auth/jwt_validator.go`
- Auth interceptor in `internal/infrastructure/auth/interceptor.go`
- User ID extracted from JWT and injected into context
- Anonymous endpoints can be configured in interceptor whitelist

## Key Patterns

### Dependency Injection (Wire)

Wire configuration in `internal/app/`:
- `wire.go`: Wire provider sets
- `wire_gen.go`: Auto-generated (DO NOT EDIT)
- `container.go`: Aggregates dependencies

After changing Wire providers:
```bash
make generate
```

### Error Handling

- Repository layer: Returns domain errors (`entity.ErrNotFound`, `entity.ErrDuplicateKey`)
- UseCase layer: Returns domain errors, wraps with context
- Adapter layer: Maps domain errors to gRPC status codes (`internal/adapter/mapping/error.go`)

### Filter Expressions

The `pkg/filterexpr` package provides CEL-based filtering for list queries:
- Supports field comparisons, logical operators (AND, OR, NOT)
- Automatically binds CEL expressions to Ent predicates
- Used in List* endpoints for flexible filtering

Example:
```
filter: "mastery.overall >= 300 && tags.contains('important')"
```

### Testing Utilities

- `internal/adapter/connectrpc/testutil.go`: Helpers for ConnectRPC handler testing
- Shared test fixtures can be added to `*_test.go` files

## Common Tasks

### Adding a New API Endpoint

1. Define in `.proto` file under `api/proto/`
2. Run `make generate` to generate Go code
3. Implement handler in `internal/adapter/connectrpc/*_service.go`
4. Add usecase method if needed in `internal/usecase/`
5. Register service in `internal/infrastructure/server/server.go`

### Adding a New Entity

1. Define struct in `internal/entity/`
2. Define repository interface in `internal/repository/`
3. Create Ent schema in `internal/infrastructure/database/entschema/`
4. Run `make ent-generate`
5. Implement repository in `internal/adapter/repository/`
6. Add usecase logic in `internal/usecase/`
7. Add mapping to protobuf in `internal/adapter/mapping/`

### Modifying Mastery Calculation

The mastery calculation formula is in `internal/entity/learned_word.go`:
- `CalculateOverall()`: Computes weighted overall score
- `InitializeFromUserMasteryLevel()`: Maps user level (1-5) to four dimensions
- `CalculateMasteryLevel()`: Converts overall score back to level

**IMPORTANT**: When changing mastery logic, also update FSRS mapping in `internal/usecase/spaced_repetition_fsrs.go`:
- `calculateStabilityFromMastery()`
- `calculateDifficultyFromMastery()`
- `masteryLevelToFSRSState()`

## License & Contribution

- Licensed under AGPL-3.0 (see LICENSE)
- Contributions welcome (see CONTRIBUTING.md)
- Commit message format: `type: description` (feat, fix, refactor, docs, test, chore, perf)
- Breaking changes: Prefix with `BREAKING:` in commit message
