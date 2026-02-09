# Quick Start Guide

Get started with the Sense Cleaner in 5 minutes.

## Overview

This tool now processes vocabulary data **by word** (not by lexeme). By default it uses the **CEFR-B1** wordbook, but you can select another wordbook by name or ID. Each word may have multiple lexemes (different meanings/parts of speech), and the AI processes all lexemes of a word together for better consistency.

## Step 1: Get OpenAI API Key

1. Visit https://platform.openai.com/api-keys/
2. Sign up or log in
3. Navigate to API Keys section
4. Create a new API key
5. Copy the key (starts with `sk-`)

## Step 2: Set Environment Variables

```bash
# Navigate to project root
cd /path/to/vocnet

# Set your API key
export OPENAI_API_KEY="sk-your-key-here"

# Optional: Use custom database
export DATABASE_URL="file:./data/vocnet.db?_fk=1"
```

## Step 3: Test with Dry Run

Run on first 10 words from CEFR-B1 to see what would change:

```bash
go run ./hack/sense-cleaner/... -dry-run -limit 10
```

Expected output:
```
Connecting to database: file:./data/vocnet.db?_fk=1
Starting sense cleaning process...
🔍 DRY RUN MODE - No changes will be made to database
Querying wordbook by name (contains, case-insensitive): CEFR-B1
Found 1500 words in wordbook "CEFR-B1"
Processing 10 words (after filtering)
Found 10 words with lexemes to process
Progress: 10/10 processed (cleaned: 8, skipped: 2, failed: 0)

📊 SENSE CLEANING SUMMARY
⏱️  Duration: 15s
📝 Total Processed: 10
✅ Successfully Cleaned: 8
...
```

## Step 4: Review Results

Check the generated report:

```bash
cat reports/sense_cleaning_report.json | jq .
```

Look at the `examples` array to see before/after comparisons of both sense_gloss and detailed senses.

## Step 5: Clean CEFR-B1 Words

### Clean with Filters (Optional)

You can still apply language and POS filters to the CEFR-B1 words:

```bash
# Clean only English words from CEFR-B1
go run ./hack/sense-cleaner/... -language en -limit 50

# Clean only verbs from CEFR-B1
go run ./hack/sense-cleaner/... -pos verb -limit 50
```

### Choose a Wordbook

```bash
# By name (partial match, case-insensitive)
go run ./hack/sense-cleaner/... -wordbook "CEFR-B2" -limit 10

# By ID (overrides --wordbook)
go run ./hack/sense-cleaner/... -wordbook-id 42 -limit 10
```

### Clean All CEFR-B1 Words

```bash
# Backup database first!
cp data/vocnet.db data/vocnet.db.backup

# Dry run to estimate
go run ./hack/sense-cleaner/... -dry-run

# If satisfied, run for real on all CEFR-B1 words
go run ./hack/sense-cleaner/... -batch-size 10
```

**Important**: The tool automatically queries the selected wordbook and only processes words in that list. You don't need to specify any word list manually.

## Common Issues

### Issue: "API key required"
**Solution**: Make sure environment variable is set:
```bash
echo $OPENAI_API_KEY
```

### Issue: "wordbook not found"
**Solution**: The selected wordbook doesn't exist in your database. Check:
```bash
# SQLite
sqlite3 data/vocnet.db "SELECT name FROM wordbooks WHERE name LIKE '%B1%';"

# PostgreSQL
psql $DATABASE_URL -c "SELECT name FROM wordbooks WHERE name ILIKE '%B1%';"
```

If no wordbook exists, you need to import the wordbook first.

### Issue: "Found 0 words with lexemes to process"
**Solution**: The words in your selected wordbook don't have associated lexemes with senses. This could mean:
1. The wordbook exists but has no terms
2. The words in the wordbook don't have matching lemmas/lexemes in the database
3. The lexemes don't have senses data yet

### Issue: Rate limiting (429 errors)
**Solution**: Reduce batch size:
```bash
go run ./hack/sense-cleaner/... -batch-size 5
```

## Tips

- **Start Small**: Use `-limit 10` to test
- **Resume with Offset**: Use `-offset 200` to continue from a specific wordbook index
- **Use Filters**: `-language en -pos verb` to focus
- **Monitor Costs**: OpenAI API charges per token (see README.md)
- **Check Examples**: Review report before large runs
- **Backup First**: Always backup database before production runs

## Next Steps

- Read the full [README.md](README.md) for all options
- Review [cost estimation](README.md#cost-estimation)
- Customize the AI prompt in `openai_client.go` if needed

## Support

If you encounter issues:
1. Check the `reports/sense_cleaning_report.json` for errors
2. Run with `-dry-run` to debug
3. Open an issue in the vocnet repository
