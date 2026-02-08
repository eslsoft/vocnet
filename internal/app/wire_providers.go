package app

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/eslsoft/vocnet/internal/infrastructure/auth"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	"github.com/eslsoft/vocnet/internal/infrastructure/datasource"
)

// provideJWTValidator creates a JWT validator from configuration
func provideJWTValidator(cfg *config.Config) (*auth.JWTValidator, func(), error) {
	if cfg.Auth.JWKSURL == "" {
		return nil, nil, fmt.Errorf("auth: JWKS URL is required in configuration")
	}

	validatorConfig := &auth.JWTValidatorConfig{
		JWKSURL:       cfg.Auth.JWKSURL,
		RefreshPeriod: cfg.Auth.RefreshPeriod,
	}

	validator, err := auth.NewJWTValidator(context.Background(), validatorConfig)
	if err != nil {
		return nil, nil, fmt.Errorf("create JWT validator: %w", err)
	}

	// Return cleanup function
	cleanup := func() {
		if err := validator.Close(); err != nil {
			// Log error but don't fail cleanup
			fmt.Printf("failed to close JWT validator: %v\n", err)
		}
	}

	return validator, cleanup, nil
}

// provideDataSourceManager creates a data source manager for the pipeline.
func provideDataSourceManager(cfg *config.Config, logger *slog.Logger) *datasource.Manager {
	return datasource.NewManager(cfg, logger, cfg.Pipeline.CacheDir)
}
