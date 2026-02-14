package backup

import (
	"testing"
)

func TestTopologicalSort(t *testing.T) {
	// Create a service to access the schema tables
	svc, err := NewService("sqlite3", "file::memory:")
	if err != nil {
		t.Fatalf("NewService failed: %v", err)
	}

	// Get all tables in dependency order
	tables, err := svc.selectTables(nil)
	if err != nil {
		t.Fatalf("selectTables failed: %v", err)
	}

	if len(tables) == 0 {
		t.Fatal("expected at least one table")
	}

	// Build a map of table names to their positions
	positions := make(map[string]int)
	for i, tbl := range tables {
		positions[tbl.Name] = i
		t.Logf("Position %d: %s", i, tbl.Name)
	}

	// Verify foreign key constraints are respected:
	// For each table, ensure all its foreign key references come before it
	for _, tbl := range tables {
		for _, fk := range tbl.ForeignKeys {
			if fk.RefTable == nil {
				continue
			}
			refTableName := fk.RefTable.Name
			refPos, hasRef := positions[refTableName]
			curPos := positions[tbl.Name]

			if hasRef && refPos >= curPos {
				t.Errorf(
					"Foreign key constraint violation: table %q (pos %d) has FK to %q (pos %d), but referenced table should come first",
					tbl.Name, curPos, refTableName, refPos,
				)
			}
		}
	}

	// Specific checks for known dependencies
	lemmaPos, hasLemma := positions["lemmas"]
	lexemesPos, hasLexemes := positions["lexemes"]
	lemmaFormsPos, hasLemmaForms := positions["lemma_forms"]

	// Lemma must come before lexemes (lexemes has FK to lemmas)
	if hasLemma && hasLexemes {
		if lemmaPos >= lexemesPos {
			t.Errorf("lemmas (pos %d) should come before lexemes (pos %d)", lemmaPos, lexemesPos)
		}
	}

	// Lemma must come before lemma_forms (lemma_forms has FK to lemmas)
	if hasLemma && hasLemmaForms {
		if lemmaPos >= lemmaFormsPos {
			t.Errorf("lemmas (pos %d) should come before lemma_forms (pos %d)", lemmaPos, lemmaFormsPos)
		}
	}

	// Note: lexemes and lemma_forms both only depend on lemmas, not on each other.
	// Their relative order is determined by alphabetical sorting and is not critical
	// for backup/restore operations as long as FK constraints are respected.

	// Verify deterministic order: running again should give same result
	tables2, err := svc.selectTables(nil)
	if err != nil {
		t.Fatalf("selectTables (2nd call) failed: %v", err)
	}

	if len(tables) != len(tables2) {
		t.Fatalf("table count mismatch: %d vs %d", len(tables), len(tables2))
	}

	for i := range tables {
		if tables[i].Name != tables2[i].Name {
			t.Errorf("position %d: expected %s, got %s (non-deterministic order)", i, tables[i].Name, tables2[i].Name)
		}
	}
}
