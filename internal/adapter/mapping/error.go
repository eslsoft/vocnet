package mapping

import (
	"errors"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/eslsoft/vocnet/internal/entity"
)

func ToPbError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, entity.ErrInvalidLexemeText), errors.Is(err, entity.ErrInvalidLexemeID):
		return status.Error(codes.InvalidArgument, err.Error())
	case errors.Is(err, entity.ErrLexemeNotFound):
		return status.Error(codes.NotFound, err.Error())
	case errors.Is(err, entity.ErrWordNotFound):
		return status.Error(codes.NotFound, err.Error())
	case errors.Is(err, entity.ErrDuplicateLexeme):
		return status.Error(codes.AlreadyExists, err.Error())
	default:
		return status.Error(codes.Internal, err.Error())
	}
}
