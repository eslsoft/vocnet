package entity

import "errors"

// Domain errors for user entity and related aggregates.
var (
	ErrInvalidInput             = errors.New("invalid input")
	ErrUserNotFound             = errors.New("user not found")
	ErrInvalidUserName          = errors.New("invalid user name")
	ErrInvalidUserEmail         = errors.New("invalid user email")
	ErrUserAlreadyExists        = errors.New("user already exists")
	ErrInvalidUserID            = errors.New("invalid user ID")
	ErrLearnedLexemeNotFound    = errors.New("user lexeme not found")
	ErrDuplicateLearnedLexeme   = errors.New("user lexeme already exists")
	ErrInvalidLearnedLexemeText = errors.New("invalid user lexeme text")
	ErrLexemeRequired           = errors.New("lexeme id is required")
	ErrLexemeNotFound           = errors.New("lexeme not found")
	ErrLanguageMismatch         = errors.New("language mismatch")
	ErrInvalidLexemeID          = errors.New("invalid lexeme id")
	ErrInvalidLexemeText        = errors.New("invalid lexeme text")
	ErrDuplicateLexeme          = errors.New("lexeme already exists")
	ErrWordNotFound             = errors.New("word not found")
	ErrInvalidWordID            = errors.New("invalid word id")
	ErrDuplicateWord            = errors.New("word already exists")

	ErrPipelineJobNotFound = errors.New("pipeline job not found")
)
