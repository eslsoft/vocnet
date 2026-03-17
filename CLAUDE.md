# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vocnet is an open-source vocabulary network management platform that serves as a centralized vocabulary data hub. It provides:

- Semantic distillation pipeline that aggregates data from multiple sources (Wikidata, ECDICT, WordNet, ConceptNet, Moby) into high-quality lemma snapshots
- Quality-scored vocabulary data with multi-dimensional metrics (completeness, depth, density, validity)
- ConnectRPC-based API with auto-generated SDKs for all platforms
- Support for SQLite (default) and PostgreSQL databases

The project targets app developers who integrate it as a vocabulary data backend, providing enriched dictionary data (lemmas, lexemes, forms, relations, phonetics, categories).

## Architecture

### Clean Architecture Layers

The codebase follows Clean Architecture with strict dependency rules:

```
internal/
├── entity/          # Core domain models (no external dependencies)
├── repository/      # Repository interfaces (defined by usecases)
├── usecase/         # Business logic (depends on entity + repository interfaces)
│   └── pipeline/    # Semantic distillation pipeline engine
│       ├── collection/   # Collection phase processors
│       ├── evaluation/   # Evaluation phase (FragmentEvaluator)
│       ├── integration/  # Integration phase (IntegrationProcessor)
│       ├── scoring/      # Quality scoring (RuleBasedScorer, DataEvaluator)
│       ├── snapshot/     # Snapshot phase + quality calculation
│       └── persist/      # Stage-boundary persistence
├── adapter/         # Implementation of external interfaces
│   ├── connectrpc/  # gRPC/ConnectRPC handlers (thin layer, validation only)
│   ├── repository/  # Repository implementations using Ent ORM
│   ├── mapping/     # Entity ↔ Protobuf conversions
│   └── provider/    # Data source providers
│       ├── wikidata/  # Wikidata lexeme provider (built-in)
│       ├── moby/      # Moby hyphenation provider (built-in)
│       ├── cefrj/     # CEFR-J level provider (built-in)
│       ├── llm/       # LLM enrichment provider (optional)
│       └── contrib/   # External process providers via JSON-RPC (ECDICT, ConceptNet, WordNet)
├── infrastructure/  # External concerns (DB, auth, server)
│   ├── database/    # Ent ORM schemas and client
│   │   └── entschema/ # Ent schema definitions
│   ├── auth/        # JWT validation and interceptors
│   ├── config/      # Configuration loading
│   ├── datasource/  # Data source download manager
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

#### Lemma
The central entity (`internal/entity/lemma.go`): dictionary headword (e.g., "run"). Each lemma tracks:
- **Surface**: The canonical form of the word
- **Normalized**: Lowercase form for case-insensitive querying
- **Variant**: Alternate spelling/variant info
- **Level**: CEFR level (A1-C2)
- **Frequencies**: Corpus frequency data
- **Syllables**: Syllable breakdown
- **Forms**: Inflected forms (`LemmaForm`) with phonetics and syllables

#### Lexeme
Semantic entry (`internal/entity/lexeme.go`): Wikidata lexeme with specific grammatical sense. Each lexeme has:
- **PartOfSpeech**: Grammatical category
- **EntryType**: WORD, PHRASE, or IDIOM
- **Senses**: Language-specific glosses with examples
- **Categories**: Domain categories
- **Completeness**: Data completeness score (0-100)

#### LemmaSnapshot
Final output of the pipeline (`internal/entity/lemma_snapshot.go`): a quality-scored, aggregated view of a lemma combining data from all sources. Includes:
- **QualityScore**: Multi-dimensional (Overall, Completeness, Depth, Density, Validity)
- Aggregated senses, forms, relations from best-scoring sources

#### WordEntry
Lookup carrier (`internal/entity/word_entry.go`): combines a Lemma with its Lexemes and Relations for API responses.

### Database Schema (Ent ORM)

Schemas are defined in `internal/infrastructure/database/entschema/`:
- `lemma.go`: Dictionary headwords
- `lemma_form.go`: Inflected forms
- `lemma_snapshot.go`: Final lemma snapshots with quality scores
- `lexeme.go`: Wikidata lexemes
- `semantic_relation.go`: Semantic relations between lemmas
- `pipeline_job.go`: Pipeline job tracking
- `pipeline_stage.go`: Pipeline execution stage tracking
- `raw_evidence.go`: Raw evidence from data sources before evaluation
- `distill_cache.go`: Cache for LLM enrichment responses

**After modifying schemas**, regenerate Ent client:
```bash
make ent-generate
```

### API (ConnectRPC)

Proto definitions are in `api/proto/`:
- `dict/`: Dictionary services (words, lemmas, lexemes)
- `pipeline/`: Pipeline services (job management, status)
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

### ConnectRPC Services

- `internal/adapter/connectrpc/dict_service.go`: Dictionary API (words, lemmas, lexemes)
- `internal/adapter/connectrpc/lemma_service.go`: Lemma API
- `internal/adapter/connectrpc/pipeline_service.go`: Pipeline API (job management, status)

## Common Commands

### Development

```bash
# Setup development environment (install tools + generate code)
make setup

# Start database (PostgreSQL in Docker)
make db-up

# Run ConnectRPC server (supports both gRPC and HTTP protocols on :8080)
make run
# or with custom DB
DATABASE_URL=postgres://user:pass@localhost:5432/vocnet?search_path=vocnet make run

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
DATABASE_URL=postgres://postgres:postgres@localhost:5432/vocnet?search_path=vocnet go run . serve

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

## Pipeline

### Pipeline Commands

```bash
# Process a single word through the pipeline
go run . pipeline process <term> [--language en] [--tier 2]

# Check pipeline status for a word
go run . pipeline status <term> [--language en]

# View word snapshot
go run . pipeline snapshot <term> [--language en]

# Submit pipeline jobs (batch processing)
go run . pipeline submit <term>              # Single word
go run . pipeline submit --file words.txt    # From file (.txt or .json)
go run . pipeline submit --wordbook CEFR-A1  # Specific wordbook
go run . pipeline submit --all               # All wordbooks
go run . pipeline submit --wikidata          # All Wikidata lemmas

# Job management
go run . pipeline jobs                        # List jobs
go run . pipeline job <job-id>                # Job details
go run . pipeline stats                       # Job statistics

# Data source management
go run . pipeline source list
go run . pipeline source download             # All sources
go run . pipeline source download <name>      # Specific source (conceptnet, ecdict, wordnet, moby, wikidata)

# Quick setup: download all data sources
make pipeline-setup
```

### Pipeline Architecture

The pipeline runs in four phases: **Collection** → **Evaluation** → **Integration** → **Snapshot**.

**Async execution**: Jobs are processed by a configurable worker pool. Configuration:
- `PIPELINE_WORKER_COUNT`: Number of concurrent workers (default: 10)

Key files:
- Engine: `internal/usecase/pipeline/engine.go`
- Service API: `internal/usecase/pipeline/service.go`
- Metrics: `internal/usecase/pipeline/metrics.go` (Prometheus)
- Stage wiring: `cmd/serve.go` (`buildNewPipelineStages`)

### Data Sources

The pipeline uses a unified `SourceProvider` interface (`internal/repository/source_provider.go`). Sources are categorized as:

- **Built-in** (compiled into binary): Wikidata, Moby, CEFR-J
- **Contrib** (external processes via JSON-RPC over stdio): ECDICT, ConceptNet, WordNet (`contrib/sources/`)
- **Specialized processors** (not SourceProvider-based): CategoryInfer, SenseMapping, Enrichment, Scoring, Snapshot

Key files:
- Interface: `internal/repository/source_provider.go`
- Generic processor: `internal/usecase/pipeline/collection/generic.go`
- Source registry: `internal/usecase/pipeline/source_registry.go`
- Contrib bridge: `internal/adapter/provider/contrib/process_provider.go`
- Data source manager: `internal/infrastructure/datasource/manager.go`

**Data source configuration** in `.env`:
```bash
PIPELINE_DATA_DIR=./data
PIPELINE_AUTO_DOWNLOAD=true
# PIPELINE_CACHE_DIR=~/.cache/vocnet
PIPELINE_CONTRIB_DIR=./contrib/sources
PIPELINE_CONTRIB_LIST=ecdict,conceptnet,wordnet
```

Data sources stored under `${PIPELINE_DATA_DIR}/datasources/`:
- `conceptnet/conceptnet-assertions-5.7.0.csv` (+ `.idx.db` SQLite index)
- `ecdict/ecdict.db`
- `wordnet/` (via NLTK, requires `uv` package manager)
- `moby/mhyph.txt`
- `wikidata/lexemes.json` (+ `.idx.db` SQLite index)

All data sources use local SQLite databases. The project uses `modernc.org/sqlite` (CGO-free).

### Data Evaluation and Adoption

The pipeline includes a **mandatory** data evaluation system for quality-based adoption.

**Key Concepts:**
- **Field-level scoring**: Each field (lexemes, forms, lemma metadata, relations) scored independently (0-100)
- **Adoption decisions**: Adopt if field is empty, or if new score > existing score
- **Source trust hierarchy** (tiebreaker): Wikidata > WordNet > LLM > ECDICT > ConceptNet

**Architecture:**
- Scorer: `internal/usecase/pipeline/scoring/scorer.go`
- Merge logic: `internal/usecase/pipeline/scoring/merge.go`
- Evaluator: `internal/usecase/pipeline/evaluation/evaluator.go`
- Integration: `internal/usecase/pipeline/integration/integration.go`

### Pipeline Stage Documentation Sync (Required)

The stage-to-source extraction matrix is documented in `docs/design/pipeline-stage-data-sources.md`. Update that document when modifying:
- Stage order or processor composition in `cmd/serve.go`
- Processor extraction logic in `internal/usecase/pipeline/`
- Evidence payload/schema versions
- Data source/provider mapping changes

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
- Schema defined in `internal/adapter/connectrpc/schemas.go`

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

## License & Contribution

- Licensed under AGPL-3.0 (see LICENSE)
- Contributions welcome (see CONTRIBUTING.md)
- Commit message format: `type: description` (feat, fix, refactor, docs, test, chore, perf)
- Breaking changes: Prefix with `BREAKING:` in commit message
