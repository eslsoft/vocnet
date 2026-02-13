# Pipeline Quality Testing

This directory contains the pipeline quality testing framework that validates data completeness and quality for all built-in wordbooks.

## Overview

The quality testing system:
- **Tests all wordbooks in parallel** for fast execution
- **Generates detailed quality reports** in JSON and Markdown formats
- **Compares against baseline data** to track quality trends over time
- **Posts PR comments** showing quality deltas on each pull request
- **Automatically updates baselines** when merging to main branch

## Running Quality Tests

### Unified Command Interface

Quality tests can be run using either Makefile targets (CI-friendly) or the quality test script (developer-friendly). Both interfaces call the same underlying implementation:

**Makefile targets (recommended for CI/automation):**
```bash
make test-quality      # All words in default wordbooks (~7K words)
make test-quality-all  # All words in ALL wordbooks (~35K words)
make test-quality-fast # Quick sample (10 words/book)
make quality-baseline  # Update baseline from latest results
```

**Script interface (recommended for development):**
```bash
./scripts/quality-test.sh default  # All words (matches make test-quality)
./scripts/quality-test.sh all      # All wordbooks (matches make test-quality-all)
./scripts/quality-test.sh quick    # Quick sample (matches make test-quality-fast)
./scripts/quality-test.sh sample   # Medium sample (30 words/book)
./scripts/quality-test.sh full     # Large sample (50 words/book)
./scripts/quality-test.sh baseline # Update baseline
./scripts/quality-test.sh compare  # Compare with baseline
./scripts/quality-test.sh report   # Show latest report
```

### Local Development

Run quality tests for default wordbooks (CEFR-A1, B1, C1, IELTS, GRE):
```bash
# Using Makefile (CI/automation)
make test-quality

# Using script (development, with colors and progress)
./scripts/quality-test.sh default

# Direct go test (if you need custom flags)
go test -v -tags=integration -timeout=60m \
  ./internal/usecase/pipeline/... \
  -run TestPipelineDataQualityGates
```

Run quality tests for ALL wordbooks:
```bash
# Using Makefile
make test-quality-all

# Using script
./scripts/quality-test.sh all

# Direct go test
PIPELINE_IT_ALL_WORDBOOKS=1 \
go test -v -tags=integration -timeout=120m \
  ./internal/usecase/pipeline/... \
  -run TestPipelineDataQualityGates
```

Run specific wordbooks only:
```bash
# Using script (most flexible)
./scripts/quality-test.sh sample -w "CEFR-A1,CEFR-B1,GRE"

# Using environment variables
PIPELINE_IT_WORDBOOKS="CEFR-A1,CEFR-B1,GRE" \
go test -v -tags=integration -timeout=30m \
  ./internal/usecase/pipeline/... \
  -run TestPipelineDataQualityGates
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PIPELINE_IT_ALL_WORDBOOKS` | Test all wordbooks (1=yes) | unset (default subset) |
| `PIPELINE_IT_WORDBOOKS` | Comma-separated list of wordbook names | unset |
| `PIPELINE_IT_WORDS_PER_BOOK` | Number of words to sample per wordbook (0=all) | 0 (all words) |
| `PIPELINE_IT_DATA_DIR` | Pipeline data sources directory | `./data` |
| `PIPELINE_IT_DB_PATH` | Integration test database path | `./data/integration/pipeline-quality.db` |

## Quality Reports

After running tests, reports are saved in `reports/quality/`:

- **`latest.json`** - Machine-readable report with detailed metrics
- **`latest.md`** - Human-readable Markdown summary
- **`delta.md`** - Comparison with baseline (if baseline exists)

### Report Structure

**JSON Report** (`latest.json`):
```json
{
  "timestamp": "2026-02-13T10:30:00Z",
  "total_books": 15,
  "total_words": 1500,
  "total_passed": 1450,
  "total_failed": 50,
  "average_score": 72.5,
  "book_reports": [
    {
      "name": "CEFR-A1",
      "total_words": 500,
      "tested_words": 100,
      "average_score": 75.2,
      "min_score": 45.0,
      "max_score": 95.0,
      "min_requirement": 70.0,
      "target_score": 85.0,
      "status": "passed"
    }
  ]
}
```

**Markdown Report** (`latest.md`):
- Summary statistics
- Wordbook results table
- Failed wordbooks with details
- Failed terms breakdown

**Delta Report** (`delta.md`):
- Overall score change (🟢 improved / 🔴 declined / ⚪ stable)
- Per-wordbook score deltas
- Status changes (passed → failed or vice versa)
- Significant changes highlighted

## Baseline Management

### Creating a Baseline

On first run or to establish a new baseline:
```bash
# Run tests to generate latest.json
go test -v -tags=integration ./internal/usecase/pipeline/... -run TestPipelineDataQualityGates

# Copy latest report as baseline
mkdir -p testdata/baselines/quality
cp reports/quality/latest.json testdata/baselines/quality/baseline.json

# Commit the baseline
git add testdata/baselines/quality/baseline.json
git commit -m "chore: establish quality baseline"
```

### Automatic Baseline Updates

On every push to `main` branch, the CI automatically:
1. Runs full quality tests
2. Updates `testdata/baselines/quality/baseline.json`
3. Commits and pushes the updated baseline (with `[skip ci]`)

This ensures the baseline always reflects the current state of the main branch.

## CI/CD Integration

### GitHub Actions Workflow

The `.github/workflows/quality-check.yml` workflow:

**On Pull Requests:**
1. Runs quality tests for all wordbooks
2. Generates quality reports
3. Compares with baseline
4. Posts/updates PR comment with delta report

**On Push to Main:**
1. Runs quality tests
2. Updates baseline if changed
3. Auto-commits updated baseline

### PR Comment Format

```markdown
## 📊 Pipeline Quality Report

**Current:** 2026-02-13T10:30:00Z
**Baseline:** 2026-02-10T15:20:00Z

## Overall Score Change: 🟢 +2.35

## Wordbook Changes

| Wordbook | Current Score | Delta | Status Change | Indicator |
|----------|---------------|-------|---------------|-----------|
| CEFR-A1  | 75.20         | +3.50 | passed        | 🟢        |
| CEFR-B1  | 68.40         | -1.20 | passed        | 🔴        |
| GRE      | 62.10         | +0.50 | passed        | ⚪        |

## Significant Changes (±2.0 or status change)

### CEFR-A1
- **Score:** 71.70 → 75.20 (+3.50)
- **Status:** passed → passed
```

## Quality Thresholds

Wordbooks are classified into tiers with different quality requirements:

| Tier | Wordbooks | Min Avg | Target Avg |
|------|-----------|---------|------------|
| **Beginner** | CEFR-A1, A2, Oxford 3000 | 70 | 85 |
| **Intermediate** | CEFR-B1, B2, Oxford 5000, CET4, IELTS, TOEFL, SAT | 64 | 78 |
| **Advanced** | CEFR-C1, C2, CET6, GRE, GMAT | 57 | 72 |
| **Default** | Other wordbooks | 62 | 75 |

Tests **fail hard** if:
- Any wordbook's average score < minimum requirement
- Execution errors occur

Tests **warn** if:
- Average score < target (but ≥ minimum)

## Troubleshooting

### Tests Timeout

Increase timeout or reduce sample size:
```bash
PIPELINE_IT_WORDS_PER_BOOK=20 \
go test -v -tags=integration -timeout=60m \
  ./internal/usecase/pipeline/... \
  -run TestPipelineDataQualityGates
```

### Missing Data Sources

Ensure pipeline data sources are downloaded:
```bash
make pipeline-setup
# or
go run . pipeline source download
```

### Baseline Drift

If baseline becomes outdated:
1. Review quality changes in recent PRs
2. Decide if quality regression is acceptable
3. If acceptable, update baseline manually:
   ```bash
   cp reports/quality/latest.json testdata/baselines/quality/baseline.json
   ```

## Architecture

### Files

- `pipeline_quality_integration_test.go` - Main test entry point
- `quality_report.go` - Report data structures and generation
- `.github/workflows/quality-check.yml` - CI workflow
- `testdata/baselines/quality/baseline.json` - Baseline data
- `reports/quality/` - Generated reports (gitignored)

### Parallel Execution

The quality testing system uses **wordbook-level parallelism**:
1. Each wordbook runs in its own goroutine with an isolated SQLite database
2. Words within each wordbook are tested **serially** (one by one)
3. `sync.WaitGroup` coordinates wordbook completion
4. `sync.Mutex` protects shared report aggregation

**Why no word-level parallelism?**
- SQLite cannot reliably handle concurrent writes, even with WAL mode and limited concurrency
- Attempted concurrency limits of 3, 5, 10 all caused database deadlocks
- Serial word testing eliminates all database lock errors
- Wordbook-level parallelism still provides good performance

**Performance expectations:**
- 5 wordbooks × 50 words = 250 words in ~31 seconds
- 5 wordbooks × 100 words = 500 words in ~60 seconds (estimated)
- 5 wordbooks with all words (~18,500 total) = ~60-90 minutes (estimated)
- All 15 wordbooks with all words = ~3-4 hours (estimated)

### Score Distribution

Each wordbook report includes score distribution:
- `0-20`: Critical failures
- `20-40`: Poor quality
- `40-60`: Below average
- `60-80`: Good quality
- `80-100`: Excellent quality

This helps identify if issues are concentrated in specific score ranges.

## Best Practices

1. **Run tests locally before pushing** - Catch quality regressions early
2. **Review delta reports in PRs** - Understand quality impact of changes
3. **Investigate significant changes** - Deltas > ±2.0 or status changes
4. **Update baselines consciously** - Don't auto-accept quality drops
5. **Use appropriate sample sizes** - Balance speed vs coverage (30-50 words/book for development, 0 for CI)

## Future Enhancements

Planned improvements:
- [ ] Per-word quality breakdown (lexeme completeness, relation coverage, etc.)
- [ ] Historical trend tracking (quality over time charts)
- [ ] Slack notifications for quality regressions
- [ ] LLM-enhanced quality stage integration
- [ ] Automatic retry for flaky test failures
- [ ] Quality gate policies (e.g., block merge if score drops > 5%)
- [ ] Investigate PostgreSQL for better concurrent write performance
