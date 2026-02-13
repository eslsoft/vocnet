# Quality Baselines

This directory contains baseline quality reports for tracking data quality trends over time.

## Files

- **`baseline.json`** - The current baseline report (auto-updated on main branch merges)

## How Baselines Work

1. **Initial Setup**: Run `make quality-baseline` to create the first baseline
2. **Automatic Updates**: On every merge to `main`, CI automatically updates this baseline
3. **PR Comparisons**: PRs compare their test results against this baseline to show quality deltas

## Manual Baseline Updates

If you need to manually update the baseline:

```bash
# Run quality tests
make test-quality

# Update baseline from latest results
make quality-baseline

# Commit the updated baseline
git add testdata/baselines/quality/baseline.json
git commit -m "chore: update quality baseline"
```

## Baseline Format

The baseline is a JSON file with the following structure:

```json
{
  "timestamp": "2026-02-13T10:30:00Z",
  "total_books": 15,
  "total_words": 1500,
  "average_score": 72.5,
  "book_reports": [
    {
      "name": "CEFR-A1",
      "tested_words": 100,
      "average_score": 75.2,
      "status": "passed"
    }
  ]
}
```

## When to Update Baselines

Update baselines when:
- Making intentional improvements to data quality
- After fixing data source issues
- When quality metrics methodology changes
- After discussing and approving quality regressions

**Do not** update baselines to hide quality regressions without investigation!
