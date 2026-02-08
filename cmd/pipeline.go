package cmd

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/eslsoft/vocnet/internal/adapter/provider"
	"github.com/eslsoft/vocnet/internal/adapter/provider/conceptnet"
	"github.com/eslsoft/vocnet/internal/adapter/provider/ecdict"
	"github.com/eslsoft/vocnet/internal/adapter/provider/moby"
	"github.com/eslsoft/vocnet/internal/adapter/provider/wikidata"
	"github.com/eslsoft/vocnet/internal/adapter/provider/wordnet"
	"github.com/eslsoft/vocnet/internal/adapter/repository"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	"github.com/eslsoft/vocnet/internal/infrastructure/database"
	"github.com/eslsoft/vocnet/internal/infrastructure/datasource"
	"github.com/eslsoft/vocnet/internal/infrastructure/server"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
)

var pipelineCmd = &cobra.Command{
	Use:   "pipeline",
	Short: "Vocabulary distillation pipeline operations",
}

// processCmd processes a single word through the pipeline
var processCmd = &cobra.Command{
	Use:   "process <term>",
	Short: "Process a single word through the distillation pipeline",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		term := args[0]
		language, _ := cmd.Flags().GetString("language")
		tier, _ := cmd.Flags().GetInt32("tier")

		// Initialize dependencies
		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("load config: %w", err)
		}

		logger, err := server.NewLogger(cfg)
		if err != nil {
			return fmt.Errorf("create logger: %w", err)
		}

		// Check and optionally download data sources
		if err := ensureDataSources(cfg, logger); err != nil {
			return err
		}

		entClient, cleanup, err := database.NewEntClient(cfg)
		if err != nil {
			return fmt.Errorf("create ent client: %w", err)
		}
		defer cleanup()

		// Initialize repositories
		lemmaRepo := repository.NewLemmaRepository(entClient)
		lexemeRepo := repository.NewLexemeRepository(entClient)
		evidenceRepo := repository.NewEvidenceRepository(entClient)
		taskRepo := repository.NewPipelineTaskRepository(entClient)
		relationRepo := repository.NewSemanticRelationRepository(entClient)
		snapshotRepo := repository.NewWordSnapshotRepository(entClient)

		// Initialize providers
		wikidataProvider := wikidata.NewClient()

		// Resolve data source paths
		paths := datasource.ResolvePaths(cfg.Pipeline.DataDir)

		// Use local ConceptNet reader if available
		var conceptnetProvider provider.ConceptNetProvider
		reader, err := conceptnet.NewReader(paths.ConceptNet)
		if err != nil {
			logger.Warn("Failed to create ConceptNet reader, falling back to API client", "error", err)
			conceptnetProvider = conceptnet.NewClient()
		} else {
			conceptnetProvider = reader
			logger.Info("Using local ConceptNet data", "path", paths.ConceptNet)
		}

		// Use local ECDICT reader if available
		var ecdictReader *ecdict.Reader
		ecdictReader, err = ecdict.NewReader(paths.ECDICT)
		if err != nil {
			logger.Warn("Failed to create ECDICT reader, Phase 2 will be skipped", "error", err)
		} else {
			logger.Info("Using local ECDICT data", "path", paths.ECDICT)
		}

		// Use local WordNet reader if available
		wordnetReader := wordnet.NewReader(paths.WordNet)
		logger.Info("Using local WordNet data", "path", paths.WordNet)

		// Use local Moby reader if available
		var mobyReader *moby.Reader
		mobyReader, err = moby.NewReader(paths.Moby)
		if err != nil {
			logger.Warn("Failed to create Moby reader, syllables will not be available", "error", err)
		} else {
			logger.Info("Using local Moby syllable data", "path", paths.Moby)
		}

		// Initialize pipeline stages
		aggregator := pipeline.NewDataAggregator()
		persistence := pipeline.NewPersistence(lemmaRepo, lexemeRepo, evidenceRepo, relationRepo, snapshotRepo, aggregator, logger)
		validator := pipeline.NewValidator(lemmaRepo, lexemeRepo, logger)

		stages := []*pipeline.Stage{
			pipeline.NewStage("discovery", 1,
				pipeline.NewWikidataProcessor(wikidataProvider, logger),
				pipeline.NewCategoryInferProcessor(),
			),
			pipeline.NewStage("lexical", 2,
				pipeline.NewECDICTProcessor(ecdictReader),
				pipeline.NewMobyProcessor(mobyReader),
			),
			pipeline.NewStage("relational", 3,
				pipeline.NewConceptNetProcessor(conceptnetProvider),
				pipeline.NewWordNetProcessor(wordnetReader),
			),
			pipeline.NewStage("intellectual", 4), // empty MVP placeholder
			pipeline.NewStage("synthesis", 5,
				pipeline.NewSnapshotProcessor(),
			),
		}

		p := pipeline.NewPipeline(stages, validator, persistence, taskRepo, snapshotRepo, lemmaRepo, lexemeRepo, logger)

		// Execute pipeline
		ctx := context.Background()
		result, err := p.Run(ctx, term, language, tier)
		if err != nil {
			return fmt.Errorf("process word: %w", err)
		}

		// Print results
		fmt.Printf("Pipeline completed for: %s\n", term)
		fmt.Printf("Lemma ID: %d\n", result.Lemma.ID)
		if result.Lemma.WikidataQID != "" {
			fmt.Printf("Wikidata QID: %s\n", result.Lemma.WikidataQID)
		}
		fmt.Println("\nPhase Status:")
		for _, task := range result.Tasks {
			status := string(task.Status)
			errMsg := ""
			if task.ErrorMessage != "" {
				errMsg = fmt.Sprintf(" (error: %s)", task.ErrorMessage)
			}
			fmt.Printf("  Phase %d (%s): %s%s\n", task.Phase, getPhaseNameByNumber(task.Phase), status, errMsg)
		}

		if result.Snapshot != nil {
			fmt.Printf("\nSnapshot generated (v%d)\n", result.Snapshot.Version)
			fmt.Printf("  Quality Score: %.1f\n", result.Snapshot.QScore)
			fmt.Printf("  Lexemes: %d\n", len(result.Snapshot.Data.Lexemes))
			fmt.Printf("  Relations: %d\n", len(result.Snapshot.Data.Relations))
		}

		return nil
	},
}

// statusCmd shows pipeline status for a word
var statusCmd = &cobra.Command{
	Use:   "status <term>",
	Short: "Check processing status for a word",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		term := args[0]
		language, _ := cmd.Flags().GetString("language")

		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("load config: %w", err)
		}

		logger, err := server.NewLogger(cfg)
		if err != nil {
			return fmt.Errorf("create logger: %w", err)
		}

		entClient, cleanup, err := database.NewEntClient(cfg)
		if err != nil {
			return fmt.Errorf("create ent client: %w", err)
		}
		defer cleanup()

		taskRepo := repository.NewPipelineTaskRepository(entClient)
		lemmaRepo := repository.NewLemmaRepository(entClient)
		snapshotRepo := repository.NewWordSnapshotRepository(entClient)
		lexemeRepo := repository.NewLexemeRepository(entClient)

		p := pipeline.NewPipeline(nil, nil, nil, taskRepo, snapshotRepo, lemmaRepo, lexemeRepo, logger)

		ctx := context.Background()
		tasks, err := p.GetStatus(ctx, term, language)
		if err != nil {
			return fmt.Errorf("get status: %w", err)
		}

		fmt.Printf("Pipeline status for: %s\n", term)
		for _, task := range tasks {
			fmt.Printf("  Phase %d (%s): %s\n", task.Phase, getPhaseNameByNumber(task.Phase), task.Status)
		}

		return nil
	},
}

// snapshotCmd shows word snapshot
var snapshotCmd = &cobra.Command{
	Use:   "snapshot <term>",
	Short: "View word snapshot data",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		term := args[0]
		language, _ := cmd.Flags().GetString("language")

		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("load config: %w", err)
		}

		logger, err := server.NewLogger(cfg)
		if err != nil {
			return fmt.Errorf("create logger: %w", err)
		}

		entClient, cleanup, err := database.NewEntClient(cfg)
		if err != nil {
			return fmt.Errorf("create ent client: %w", err)
		}
		defer cleanup()

		snapshotRepo := repository.NewWordSnapshotRepository(entClient)
		lemmaRepo := repository.NewLemmaRepository(entClient)
		lexemeRepo := repository.NewLexemeRepository(entClient)
		taskRepo := repository.NewPipelineTaskRepository(entClient)

		p := pipeline.NewPipeline(nil, nil, nil, taskRepo, snapshotRepo, lemmaRepo, lexemeRepo, logger)

		ctx := context.Background()
		snapshot, err := p.GetSnapshot(ctx, term, language)
		if err != nil {
			return fmt.Errorf("get snapshot: %w", err)
		}

		fmt.Printf("Snapshot for: %s (v%d)\n", snapshot.Term, snapshot.Version)
		fmt.Printf("Language: %s\n", snapshot.Language)
		if snapshot.WikidataQID != "" {
			fmt.Printf("Wikidata QID: %s\n", snapshot.WikidataQID)
		}
		fmt.Printf("Quality Score: %.1f (completeness: %.1f, depth: %.1f, density: %.1f, validity: %.1f)\n",
			snapshot.QScore, snapshot.QScoreCompleteness, snapshot.QScoreDepth, snapshot.QScoreDensity, snapshot.QScoreValidity)
		fmt.Printf("Synthesized: %s\n", snapshot.SynthesizedAt.Format("2006-01-02 15:04:05"))

		fmt.Printf("\nLexemes: %d\n", len(snapshot.Data.Lexemes))
		for i, lex := range snapshot.Data.Lexemes {
			fmt.Printf("  %d. POS: %s, Senses: %d\n", i+1, lex.POS, len(lex.Senses))
		}

		fmt.Printf("\nRelations: %d\n", len(snapshot.Data.Relations))
		for i, rel := range snapshot.Data.Relations {
			fmt.Printf("  %d. %s → %s (provider: %s, strength: %.2f)\n",
				i+1, rel.RelationType, rel.TargetTerm, rel.Provider, rel.Strength)
		}

		return nil
	},
}

// Data management commands
var dataCmd = &cobra.Command{
	Use:   "data",
	Short: "Manage pipeline data sources",
}

var dataCheckCmd = &cobra.Command{
	Use:   "check",
	Short: "Verify all data sources exist and are valid",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("load config: %w", err)
		}

		logger, err := server.NewLogger(cfg)
		if err != nil {
			return fmt.Errorf("create logger: %w", err)
		}

		mgr := datasource.NewManager(cfg, logger, cfg.Pipeline.CacheDir)
		statuses, err := mgr.CheckAll()
		if err != nil {
			return fmt.Errorf("check data sources: %w", err)
		}

		fmt.Println("Pipeline Data Sources:")
		for _, status := range statuses {
			symbol := "✗"
			statusMsg := "not found"
			if status.Available {
				symbol = "✓"
				if status.Size > 0 {
					statusMsg = fmt.Sprintf("%.1f MB", float64(status.Size)/(1024*1024))
				} else {
					statusMsg = "verified"
				}
			} else if status.Exists {
				statusMsg = fmt.Sprintf("invalid: %s", status.ErrorMsg)
			}

			fmt.Printf("  %s %-12s %s (%s)\n", symbol, status.Name+":", status.Path, statusMsg)
		}

		// Check if any missing
		var missing []string
		for _, status := range statuses {
			if !status.Available {
				missing = append(missing, strings.ToLower(status.Name))
			}
		}

		if len(missing) > 0 {
			fmt.Printf("\nTo download missing sources, run:\n")
			fmt.Printf("  vocnet pipeline data download %s\n", strings.Join(missing, " "))
			return fmt.Errorf("missing data sources")
		}

		fmt.Println("\nAll data sources are available.")
		return nil
	},
}

var dataDownloadCmd = &cobra.Command{
	Use:   "download [source...]",
	Short: "Download missing data sources",
	Long: `Download data sources required by the pipeline.
If no source is specified, downloads all missing sources.

Available sources: conceptnet, ecdict, wordnet

Examples:
  vocnet pipeline data download            # Download all missing sources
  vocnet pipeline data download conceptnet # Download only ConceptNet
  vocnet pipeline data download ecdict wordnet # Download ECDICT and WordNet`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("load config: %w", err)
		}

		logger, err := server.NewLogger(cfg)
		if err != nil {
			return fmt.Errorf("create logger: %w", err)
		}

		mgr := datasource.NewManager(cfg, logger, cfg.Pipeline.CacheDir)
		ctx := context.Background()

		// If no sources specified, download all missing
		if len(args) == 0 {
			fmt.Println("Checking and downloading missing data sources...")
			if err := mgr.DownloadMissing(ctx); err != nil {
				return fmt.Errorf("download missing: %w", err)
			}
			fmt.Println("\nAll data sources are now available.")
			return nil
		}

		// Download specific sources
		for _, source := range args {
			fmt.Printf("Downloading %s...\n", source)
			if err := mgr.DownloadSource(ctx, source); err != nil {
				return fmt.Errorf("download %s: %w", source, err)
			}
		}

		fmt.Println("\nDownload completed.")
		return nil
	},
}

var dataListCmd = &cobra.Command{
	Use:   "list",
	Short: "List configured data sources and their status",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("load config: %w", err)
		}

		logger, err := server.NewLogger(cfg)
		if err != nil {
			return fmt.Errorf("create logger: %w", err)
		}

		mgr := datasource.NewManager(cfg, logger, cfg.Pipeline.CacheDir)
		statuses, err := mgr.CheckAll()
		if err != nil {
			return fmt.Errorf("check data sources: %w", err)
		}

		fmt.Println("Configured Data Sources:")
		for _, status := range statuses {
			fmt.Printf("\n%s:\n", status.Name)
			fmt.Printf("  Path: %s\n", status.Path)
			fmt.Printf("  Status: %v\n", status.Available)
			if !status.Available && status.ErrorMsg != "" {
				fmt.Printf("  Error: %s\n", status.ErrorMsg)
			}
		}

		return nil
	},
}

func init() {
	rootCmd.AddCommand(pipelineCmd)

	// Process command
	pipelineCmd.AddCommand(processCmd)
	processCmd.Flags().String("language", "en", "Language code")
	processCmd.Flags().Int32("tier", 2, "Priority tier (1=Core, 2=Extended, 3=LongTail)")

	// Status command
	pipelineCmd.AddCommand(statusCmd)
	statusCmd.Flags().String("language", "en", "Language code")

	// Snapshot command
	pipelineCmd.AddCommand(snapshotCmd)
	snapshotCmd.Flags().String("language", "en", "Language code")

	// Data management commands
	pipelineCmd.AddCommand(dataCmd)
	dataCmd.AddCommand(dataCheckCmd)
	dataCmd.AddCommand(dataDownloadCmd)
	dataCmd.AddCommand(dataListCmd)
}

// ensureDataSources checks if required data sources are available
// and optionally downloads them if auto-download is enabled
func ensureDataSources(cfg *config.Config, logger *slog.Logger) error {
	mgr := datasource.NewManager(cfg, logger, cfg.Pipeline.CacheDir)
	ctx := context.Background()

	// Check if data sources are available
	if err := mgr.EnsureAvailable(ctx, cfg.Pipeline.AutoDownload, "conceptnet", "ecdict", "wordnet"); err != nil {
		if !cfg.Pipeline.AutoDownload {
			fmt.Fprintln(os.Stderr, "\nError:", err)
			fmt.Fprintln(os.Stderr, "\nTo download missing data sources, run:")
			fmt.Fprintln(os.Stderr, "  vocnet pipeline data download")
			fmt.Fprintln(os.Stderr, "\nOr enable auto-download:")
			fmt.Fprintln(os.Stderr, "  export PIPELINE_AUTO_DOWNLOAD=true")
		}
		return err
	}

	return nil
}

func getPhaseNameByNumber(phase int32) string {
	switch phase {
	case 1:
		return "discovery"
	case 2:
		return "lexical"
	case 3:
		return "relational"
	case 4:
		return "intellectual"
	case 5:
		return "synthesis"
	default:
		return "unknown"
	}
}
