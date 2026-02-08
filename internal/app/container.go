package app

import (
	"log/slog"

	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	"github.com/eslsoft/vocnet/internal/infrastructure/server"
	"github.com/eslsoft/vocnet/internal/usecase"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
)

// Container aggregates the application dependencies produced by Wire.
type Container struct {
	Logger           *slog.Logger
	Config           *config.Config
	Server           *server.Server
	EntClient        *entdb.Client
	WordbookUsecase  usecase.WordbookUsecase
	PipelineService  *pipeline.PipelineService
}
