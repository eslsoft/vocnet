package repository

import (
	"entgo.io/ent/dialect/sql"
)

// orderTerm returns the appropriate SQL order term based on desc flag
func orderTerm(desc bool) sql.OrderTermOption {
	if desc {
		return sql.OrderDesc()
	}
	return sql.OrderAsc()
}
