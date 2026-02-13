# Pipeline Quality Testing Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Developer Workflow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Developer                                                       │
│     │                                                            │
│     ├─► ./scripts/quality-test.sh quick  ───┐                  │
│     ├─► make test-quality                   │                  │
│     └─► make test-quality-all               │                  │
│                                              │                  │
│                                              ▼                  │
│                        ┌──────────────────────────────┐        │
│                        │  Integration Test Runner     │        │
│                        │  (pipeline_quality_...go)    │        │
│                        └──────────────────────────────┘        │
│                                     │                           │
│                                     ▼                           │
│              ┌──────────────────────────────────┐              │
│              │   Parallel Test Execution        │              │
│              │   (goroutines + sync.WaitGroup)  │              │
│              └──────────────────────────────────┘              │
│                          │                                      │
│        ┌─────────────────┼─────────────────┐                  │
│        ▼                 ▼                 ▼                  │
│   [CEFR-A1]         [CEFR-B1]    ...   [GRE]                 │
│   goroutine         goroutine          goroutine              │
│        │                 │                 │                  │
│        └─────────────────┴─────────────────┘                  │
│                          │                                      │
│                          ▼                                      │
│              ┌──────────────────────────────────┐              │
│              │   Report Aggregation             │              │
│              │   (QualityReport)                │              │
│              └──────────────────────────────────┘              │
│                          │                                      │
│           ┌──────────────┴──────────────┐                     │
│           ▼                             ▼                     │
│   reports/quality/              testdata/baselines/           │
│   ├─ latest.json                ├─ baseline.json              │
│   ├─ latest.md                  └─ README.md                  │
│   └─ delta.md                                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         CI/CD Workflow                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Pull Request Opened/Updated                                    │
│           │                                                      │
│           ▼                                                      │
│  ┌──────────────────────┐                                      │
│  │  GitHub Actions      │                                      │
│  │  quality-check.yml   │                                      │
│  └──────────────────────┘                                      │
│           │                                                      │
│           ├─► Cache data sources                               │
│           ├─► Run quality tests (all wordbooks, 50 words/book) │
│           ├─► Generate reports                                  │
│           ├─► Compare with baseline                            │
│           └─► Post/Update PR comment                           │
│                          │                                      │
│                          ▼                                      │
│           ┌──────────────────────────────┐                     │
│           │  PR Comment                  │                     │
│           │  ┌────────────────────────┐  │                     │
│           │  │ 📊 Quality Report      │  │                     │
│           │  │                        │  │                     │
│           │  │ Overall: 🟢 +2.35     │  │                     │
│           │  │                        │  │                     │
│           │  │ CEFR-A1: 75.2 (+3.5)  │  │                     │
│           │  │ CEFR-B1: 68.4 (-1.2)  │  │                     │
│           │  │ GRE:     62.1 (+0.5)  │  │                     │
│           │  └────────────────────────┘  │                     │
│           └──────────────────────────────┘                     │
│                                                                 │
│  Merged to Main                                                │
│           │                                                      │
│           ▼                                                      │
│  ┌──────────────────────┐                                      │
│  │  Update Baseline     │                                      │
│  │  (auto-commit)       │                                      │
│  └──────────────────────┘                                      │
│           │                                                      │
│           ▼                                                      │
│  testdata/baselines/quality/baseline.json ← updated            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Quality Test Data Flow                        │
└─────────────────────────────────────────────────────────────────┘

Input: Wordbook List
   │
   ├─► Filter eligible terms (alphabetic only)
   ├─► Sample N words per book (configurable)
   └─► Deduplicate terms
        │
        ▼
   Parallel Execution
        │
        ├─► For each wordbook:
        │    │
        │    ├─► For each term:
        │    │    │
        │    │    ├─► Run pipeline (create job)
        │    │    ├─► Get quality score
        │    │    └─► Collect results
        │    │
        │    ├─► Calculate statistics:
        │    │    ├─ Average score
        │    │    ├─ Min/Max score
        │    │    ├─ Score distribution
        │    │    ├─ Pass/Fail counts
        │    │    └─ Failed terms list
        │    │
        │    └─► Generate WordbookQualityReport
        │
        ▼
   Aggregate Results
        │
        ├─► Calculate overall metrics
        ├─► Create QualityReport
        └─► Save reports
             │
             ├─► JSON (latest.json)
             ├─► Markdown (latest.md)
             └─► Delta (delta.md) ← if baseline exists
```

## Report Structure

```
QualityReport
├─ timestamp: time.Time
├─ total_books: int
├─ total_words: int
├─ total_passed: int
├─ total_failed: int
├─ average_score: float64
├─ execution_time: string
└─ book_reports: []WordbookQualityReport
    │
    └─► WordbookQualityReport
         ├─ name: string
         ├─ total_words: int
         ├─ tested_words: int
         ├─ passed_words: int
         ├─ failed_words: int
         ├─ average_score: float64
         ├─ min_score: float64
         ├─ max_score: float64
         ├─ min_requirement: float64
         ├─ target_score: float64
         ├─ score_distribution: map[string]int
         │   ├─ "0-20": int
         │   ├─ "20-40": int
         │   ├─ "40-60": int
         │   ├─ "60-80": int
         │   └─ "80-100": int
         ├─ failed_terms: []FailedTerm
         │   └─► FailedTerm
         │        ├─ term: string
         │        ├─ score: float64
         │        ├─ min_requirement: float64
         │        └─ reason: string
         ├─ execution_errors: []string
         └─ status: string ("passed"|"failed"|"error")
```

## Baseline Comparison

```
Current Report + Baseline Report
         │
         ▼
    CompareTo()
         │
         ├─► Create map of baseline books
         ├─► For each current book:
         │    ├─ Find matching baseline book
         │    ├─ Calculate delta:
         │    │   ├─ score_delta = current - baseline
         │    │   ├─ passed_delta = current - baseline
         │    │   └─ failed_delta = current - baseline
         │    └─ Determine status change
         │
         ├─► Sort by absolute delta (biggest first)
         └─► Generate QualityDelta
              │
              ├─ overall_delta: float64
              └─ book_deltas: []WordbookDelta
                   │
                   └─► WordbookDelta
                        ├─ name: string
                        ├─ score_delta: float64
                        ├─ current_score: float64
                        ├─ baseline_score: float64
                        ├─ current_status: string
                        ├─ baseline_status: string
                        ├─ passed_delta: int
                        ├─ failed_delta: int
                        └─ is_new: bool
```

## Concurrency Model

The quality testing system uses **wordbook-level parallelism** only:

```
Main Test Goroutine
      │
      ├─► Create sync.WaitGroup
      ├─► Create sync.Mutex (for result aggregation)
      │
      └─► For each wordbook:
           │
           ├─► wg.Add(1)
           └─► go func(wordbook):
                │
                ├─► Create isolated SQLite database for this wordbook
                ├─► Test words SERIALLY (one by one)
                ├─► Generate WordbookQualityReport
                │
                ├─► mu.Lock()
                ├─► bookReports[idx] = report
                ├─► mu.Unlock()
                │
                └─► wg.Done()

      Wait for all goroutines (wg.Wait())
      │
      ▼
   Aggregate results into QualityReport
```

**Design Decision: No Word-Level Parallelism**

Words within each wordbook are tested serially (not in parallel) because:
- SQLite cannot reliably handle concurrent writes even with WAL mode
- Attempted concurrency limits of 3, 5, 10 all caused database deadlocks
- Each wordbook has its own isolated database, avoiding inter-wordbook contention
- Wordbook-level parallelism still provides good performance (5 wordbooks run concurrently)

**Performance Characteristics:**
- 5 wordbooks × 50 words = 250 words in ~31 seconds
- Linear scaling within wordbook, parallel scaling across wordbooks
- No database lock errors or race conditions

## File Organization

```
vocnet/
├─ internal/usecase/pipeline/
│  ├─ pipeline_quality_integration_test.go  ← Test entry point
│  └─ quality_report.go                     ← Report structures
│
├─ testdata/baselines/quality/
│  ├─ baseline.json                         ← Current baseline
│  └─ README.md                             ← Baseline docs
│
├─ reports/quality/                         ← Generated (gitignored)
│  ├─ latest.json                           ← Latest test results
│  ├─ latest.md                             ← Human-readable report
│  └─ delta.md                              ← Comparison with baseline
│
├─ .github/workflows/
│  └─ quality-check.yml                     ← CI workflow
│
├─ scripts/
│  └─ quality-test.sh                       ← Developer helper script
│
├─ docs/guides/
│  └─ pipeline-quality-testing.md           ← Full documentation
│
└─ Makefile                                  ← Make targets
```
