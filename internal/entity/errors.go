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
	ErrLearnedWordNotFound      = errors.New("user word not found")
	ErrDuplicateLearnedWord     = errors.New("user word already exists")
	ErrInvalidLearnedWordText   = errors.New("invalid user word text")
	ErrLexemeNotFound           = errors.New("lexeme not found")
	ErrInvalidLexemeID          = errors.New("invalid lexeme id")
	ErrInvalidLexemeText        = errors.New("invalid lexeme text")
	ErrDuplicateLexeme          = errors.New("lexeme already exists")
	ErrWordNotFound             = errors.New("word not found")
	ErrInvalidWordID            = errors.New("invalid word id")
	ErrDuplicateWord            = errors.New("word already exists")

	ErrWordbookNotFound      = errors.New("wordbook not found")
	ErrInvalidWordbookID     = errors.New("invalid wordbook id")
	ErrInvalidWordbookName   = errors.New("invalid wordbook name")
	ErrInvalidWordbookUser   = errors.New("invalid wordbook owner")
	ErrBuiltinWordbookLocked = errors.New("builtin wordbook is read-only")
	ErrDuplicateWordbook     = errors.New("wordbook already exists")
)
