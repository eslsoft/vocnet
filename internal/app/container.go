package app

import (
	"log/slog"

	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	"github.com/eslsoft/vocnet/internal/infrastructure/server"
	"github.com/eslsoft/vocnet/internal/usecase"
)

// Container aggregates the application dependencies produced by Wire.
type Container struct {
	Logger          *slog.Logger
	Server          *server.Server
	EntClient       *entdb.Client
	WordbookUsecase usecase.WordbookUsecase
}
