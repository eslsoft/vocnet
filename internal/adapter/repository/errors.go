package repository

import (
	"errors"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	"github.com/jackc/pgx/v5/pgconn"
)

// translateDBError converts database-specific errors to domain errors.
// This provides a centralized place to handle constraint violations and other DB errors.
func translateDBError(err error, entityType string) error {
	if err == nil {
		return nil
	}

	// Check for ent NotFound error
	if entdb.IsNotFound(err) {
		switch entityType {
		case "word":
			return entity.ErrWordNotFound
		case "lexeme":
			return entity.ErrLexemeNotFound
		case "learned_lexeme":
			return entity.ErrLearnedLexemeNotFound
		case "wordbook":
			return entity.ErrWordbookNotFound
		case "pipeline_job":
			return entity.ErrPipelineJobNotFound
		default:
			return err
		}
	}

	// Check for ent ConstraintError
	if entdb.IsConstraintError(err) {
		// Try to extract the PostgreSQL error from within the ent error
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			// unique_violation
			switch entityType {
			case "word":
				return entity.ErrDuplicateWord
			case "lexeme":
				return entity.ErrDuplicateLexeme
			case "learned_word":
				return entity.ErrDuplicateLearnedWord
			case "learned_lexeme":
				return entity.ErrDuplicateLearnedLexeme
			case "wordbook":
				return entity.ErrDuplicateWordbook
			}
		}

		// Fallback: check error message for duplicate key
		errMsg := err.Error()
		if strings.Contains(errMsg, "duplicate key") || strings.Contains(errMsg, "unique constraint") {
			switch entityType {
			case "word":
				return entity.ErrDuplicateWord
			case "lexeme":
				return entity.ErrDuplicateLexeme
			case "learned_word":
				return entity.ErrDuplicateLearnedWord
			case "learned_lexeme":
				return entity.ErrDuplicateLearnedLexeme
			case "wordbook":
				return entity.ErrDuplicateWordbook
			}
		}
	}

	return err
}
