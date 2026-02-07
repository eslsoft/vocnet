package cmd

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/eslsoft/vocnet/internal/adapter/provider/conceptnet"
	"github.com/eslsoft/vocnet/internal/adapter/provider/wikidata"
	"github.com/eslsoft/vocnet/internal/adapter/repository"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	"github.com/eslsoft/vocnet/internal/infrastructure/database"
	"github.com/eslsoft/vocnet/internal/infrastructure/server"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
)

var pipelineCmd = &cobra.Command{
	Use:   "pipeline",
	Short: "Vocabulary distillation pipeline operations",
}

var processWordCmd = &cobra.Command{
	Use:   "process-word <term>",
	Short: "Process a word through the distillation pipeline",
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
		conceptnetProvider := conceptnet.NewClient()

		// Initialize phases
		phases := []pipeline.Phase{
			pipeline.NewPhase1Discovery(wikidataProvider),
			pipeline.NewPhase2Lexical(),
			pipeline.NewPhase3Relational(conceptnetProvider, lexemeRepo),
			pipeline.NewPhase4Intellectual(),
			pipeline.NewPhase5Synthesis(lemmaRepo, lexemeRepo, relationRepo, snapshotRepo),
		}

		// Initialize orchestrator
		orchestrator := pipeline.NewOrchestrator(
			lemmaRepo,
			lexemeRepo,
			evidenceRepo,
			taskRepo,
			relationRepo,
			snapshotRepo,
			phases,
			logger,
		)

		// Execute pipeline
		ctx := context.Background()
		result, err := orchestrator.ProcessWord(ctx, term, language, tier)
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

var statusCmd = &cobra.Command{
	Use:   "status <term>",
	Short: "Get pipeline status for a word",
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
		lexemeRepo := repository.NewLexemeRepository(entClient)
		evidenceRepo := repository.NewEvidenceRepository(entClient)
		relationRepo := repository.NewSemanticRelationRepository(entClient)
		snapshotRepo := repository.NewWordSnapshotRepository(entClient)

		orchestrator := pipeline.NewOrchestrator(
			lemmaRepo,
			lexemeRepo,
			evidenceRepo,
			taskRepo,
			relationRepo,
			snapshotRepo,
			nil, // phases not needed for status
			logger,
		)

		ctx := context.Background()
		tasks, err := orchestrator.GetStatus(ctx, term, language)
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

var snapshotCmd = &cobra.Command{
	Use:   "snapshot <term>",
	Short: "Get word snapshot",
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
		evidenceRepo := repository.NewEvidenceRepository(entClient)
		taskRepo := repository.NewPipelineTaskRepository(entClient)
		relationRepo := repository.NewSemanticRelationRepository(entClient)

		orchestrator := pipeline.NewOrchestrator(
			lemmaRepo,
			lexemeRepo,
			evidenceRepo,
			taskRepo,
			relationRepo,
			snapshotRepo,
			nil,
			logger,
		)

		ctx := context.Background()
		snapshot, err := orchestrator.GetSnapshot(ctx, term, language)
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

func init() {
	rootCmd.AddCommand(pipelineCmd)

	// process-word subcommand
	pipelineCmd.AddCommand(processWordCmd)
	processWordCmd.Flags().String("language", "en", "Language code")
	processWordCmd.Flags().Int32("tier", 2, "Priority tier (1=Core, 2=Extended, 3=LongTail)")

	// status subcommand
	pipelineCmd.AddCommand(statusCmd)
	statusCmd.Flags().String("language", "en", "Language code")

	// snapshot subcommand
	pipelineCmd.AddCommand(snapshotCmd)
	snapshotCmd.Flags().String("language", "en", "Language code")
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
