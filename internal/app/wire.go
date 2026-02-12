//go:build wireinject

package app

import (
	"github.com/google/wire"

	adaptergrpc "github.com/eslsoft/vocnet/internal/adapter/connectrpc"
	"github.com/eslsoft/vocnet/internal/adapter/repository"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	"github.com/eslsoft/vocnet/internal/infrastructure/database"
	"github.com/eslsoft/vocnet/internal/infrastructure/server"
	"github.com/eslsoft/vocnet/internal/usecase"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"

	"github.com/eslsoft/vocnet/pkg/api/dict/v1/dictv1connect"
	"github.com/eslsoft/vocnet/pkg/api/pipeline/v1/pipelinev1connect"
)

var configSet = wire.NewSet(
	config.Load,
)

var databaseSet = wire.NewSet(
	database.NewEntClient,
)

var repositorySet = wire.NewSet(
	repository.NewLexemeRepository,
	repository.NewLemmaRepository,
	repository.NewEvidenceRepository,
	repository.NewPipelineStageRepository,
	repository.NewSemanticRelationRepository,
	repository.NewLemmaSnapshotRepository,
	repository.NewPipelineJobRepository,
)

var usecaseSet = wire.NewSet(
	usecase.NewLexemeUsecase,
	usecase.NewWordUsecase,
	pipeline.NewPipelineService,
	pipeline.NewLemmaQueryService,
)

var serviceSet = wire.NewSet(
	adaptergrpc.NewDictServiceServer,
	adaptergrpc.NewPipelineServiceServer,
	adaptergrpc.NewLemmaServiceServer,
	wire.Bind(new(dictv1connect.DictServiceHandler), new(*adaptergrpc.DictServiceServer)),
	wire.Bind(new(dictv1connect.LemmaServiceHandler), new(*adaptergrpc.LemmaServiceServer)),
	wire.Bind(new(pipelinev1connect.PipelineServiceHandler), new(*adaptergrpc.PipelineServiceServer)),
)

var serverSet = wire.NewSet(
	server.NewLogger,
	server.NewServer,
)

// Initialize builds the application container using Wire.
func Initialize() (*Container, func(), error) {
	wire.Build(
		configSet,
		databaseSet,
		repositorySet,
		usecaseSet,
		serviceSet,
		serverSet,
		wire.Struct(new(Container), "*"),
	)
	return nil, nil, nil
}
