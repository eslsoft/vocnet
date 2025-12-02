package mapping

import (
	"errors"

	"connectrpc.com/connect"
	"github.com/eslsoft/vocnet/internal/entity"
)

func ToPbError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, entity.ErrInvalidInput):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, entity.ErrInvalidLexemeText), errors.Is(err, entity.ErrInvalidLexemeID):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, entity.ErrLexemeNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, entity.ErrWordNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, entity.ErrDuplicateLexeme):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, entity.ErrDuplicateWord):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, entity.ErrDuplicateLearnedLexeme):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, entity.ErrInvalidWordbookID),
		errors.Is(err, entity.ErrInvalidWordbookName),
		errors.Is(err, entity.ErrInvalidWordbookUser):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, entity.ErrWordbookNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, entity.ErrDuplicateWordbook):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, entity.ErrBuiltinWordbookLocked):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
