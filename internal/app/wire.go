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
	"github.com/eslsoft/vocnet/pkg/api/learning/v1/learningv1connect"
	"github.com/eslsoft/vocnet/pkg/api/pipeline/v1/pipelinev1connect"
	"github.com/eslsoft/vocnet/pkg/api/wordbook/v1/wordbookv1connect"
)

var configSet = wire.NewSet(
	config.Load,
)

var databaseSet = wire.NewSet(
	database.NewEntClient,
)

var authSet = wire.NewSet(
	provideJWTValidator,
)

var infrastructureSet = wire.NewSet(
	provideDataSourceManager,
)

var repositorySet = wire.NewSet(
	repository.NewLexemeRepository,
	repository.NewLearnedWordRepository,
	repository.NewLemmaRepository,
	repository.NewWordbookRepository,
	repository.NewReviewPlanRepository,
	repository.NewDailyStatsRepository,
	repository.NewEvidenceRepository,
	repository.NewPipelineTaskRepository,
	repository.NewSemanticRelationRepository,
	repository.NewWordSnapshotRepository,
	repository.NewPipelineJobRepository,
)

var usecaseSet = wire.NewSet(
	usecase.NewLexemeUsecase,
	usecase.NewWordUsecase,
	usecase.NewLearnedWordUsecase,
	usecase.NewWordbookUsecase,
	usecase.NewCardGeneratorFactory,
	usecase.NewFSRSAlgorithm,
	usecase.NewReviewPlanUsecase,
	usecase.NewStatsUsecase,
	pipeline.NewPipelineService,
)

var serviceSet = wire.NewSet(
	adaptergrpc.NewDictServiceServer,
	adaptergrpc.NewLearningServiceServer,
	adaptergrpc.NewWordbookServiceServer,
	adaptergrpc.NewReviewPlanServiceServer,
	adaptergrpc.NewStatsServiceServer,
	adaptergrpc.NewPipelineServiceServer,
	wire.Bind(new(learningv1connect.LearningServiceHandler), new(*adaptergrpc.LearningServiceServer)),
	wire.Bind(new(dictv1connect.DictServiceHandler), new(*adaptergrpc.DictServiceServer)),
	wire.Bind(new(wordbookv1connect.WordbookServiceHandler), new(*adaptergrpc.WordbookServiceServer)),
	wire.Bind(new(learningv1connect.ReviewPlanServiceHandler), new(*adaptergrpc.ReviewPlanServiceServer)),
	wire.Bind(new(learningv1connect.StatsServiceHandler), new(*adaptergrpc.StatsServiceServer)),
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
		authSet,
		infrastructureSet,
		repositorySet,
		usecaseSet,
		serviceSet,
		serverSet,
		wire.Struct(new(Container), "*"),
	)
	return nil, nil, nil
}
