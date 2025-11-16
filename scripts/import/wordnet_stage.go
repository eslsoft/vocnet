package main

import (
	"context"
	"log"

	"github.com/eslsoft/vocnet/pkg/api/dict/v1/dictv1connect"
)

type wordNetStage struct {
	path string
}

func newWordNetStage(path string) *wordNetStage {
	return &wordNetStage{path: path}
}

func (s *wordNetStage) Name() string { return "wordnet" }

func (s *wordNetStage) Run(ctx context.Context, client dictv1connect.DictServiceClient) error {
	log.Printf("[wordnet] data path provided (%s) but importer not implemented yet. Skipping.", s.path)
	return nil
}
