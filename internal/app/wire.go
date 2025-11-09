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

	"github.com/eslsoft/vocnet/pkg/api/dict/v1/dictv1connect"
	"github.com/eslsoft/vocnet/pkg/api/learning/v1/learningv1connect"
)

var configSet = wire.NewSet(
	config.Load,
)

var databaseSet = wire.NewSet(
	database.NewEntClient,
)

var repositorySet = wire.NewSet(
	repository.NewLexemeRepository,
	repository.NewLearnedLexemeRepository,
	repository.NewWordGroupRepository,
)

var usecaseSet = wire.NewSet(
	usecase.NewLexemeUsecase,
	usecase.NewWordUsecase,
	usecase.NewLearnedLexemeUsecase,
)

var serviceSet = wire.NewSet(
	adaptergrpc.NewDictServiceServer,
	adaptergrpc.NewLearningServiceServer,
	wire.Bind(new(learningv1connect.LearningServiceHandler), new(*adaptergrpc.LearningServiceServer)),
	wire.Bind(new(dictv1connect.DictServiceHandler), new(*adaptergrpc.DictServiceServer)),
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
		wire.Struct(new(Container), "Logger", "Server", "EntClient"),
	)
	return nil, nil, nil
}
