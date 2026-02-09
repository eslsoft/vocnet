package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/olekukonko/tablewriter"
	"github.com/spf13/cobra"

	"github.com/eslsoft/vocnet/internal/adapter/repository"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/infrastructure/config"
	"github.com/eslsoft/vocnet/internal/infrastructure/database"
	"github.com/eslsoft/vocnet/internal/infrastructure/datasource"
	"github.com/eslsoft/vocnet/internal/infrastructure/server"
	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	"github.com/eslsoft/vocnet/pkg/wordbook"
)

var pipelineCmd = &cobra.Command{
	Use:   "pipeline",
	Short: "Vocabulary distillation pipeline operations",
}

// Source management commands
var sourceCmd = &cobra.Command{
	Use:   "source",
	Short: "Manage offline data sources (ConceptNet, ECDICT, WordNet, Moby, Wikidata, CEFRJ)",
}

var sourceListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all data sources and their status",
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
		table := tablewriter.NewTable(os.Stdout)
		table.Header("STATUS", "SOURCE", "PATH", "INFO")
		for _, status := range statuses {
			symbol := "✗"
			info := "not found"
			if status.Available {
				symbol = "✓"
				if status.Size > 0 {
					info = fmt.Sprintf("%.1f MB", float64(status.Size)/(1024*1024))
				} else {
					info = "verified"
				}
			} else if status.Exists {
				info = fmt.Sprintf("invalid: %s", status.ErrorMsg)
			}

			_ = table.Append([]string{symbol, status.Name, status.Path, info})
		}
		_ = table.Render()

		// Check if any missing
		var missing []string
		for _, status := range statuses {
			if !status.Available {
				missing = append(missing, strings.ToLower(status.Name))
			}
		}

		if len(missing) > 0 {
			fmt.Printf("\nTo download missing sources, run:\n")
			fmt.Printf("  vocnet pipeline source download %s\n", strings.Join(missing, " "))
			return fmt.Errorf("missing data sources")
		}

		fmt.Println("\nAll data sources are available.")
		return nil
	},
}

var sourceDownloadCmd = &cobra.Command{
	Use:   "download [source...]",
	Short: "Download missing data sources",
	Long: `Download data sources required by the pipeline.
If no source is specified, downloads all missing sources.

Available sources: conceptnet, ecdict, wordnet, moby, wikidata, cefrj

Examples:
  vocnet pipeline source download            # Download all missing sources
  vocnet pipeline source download conceptnet # Download only ConceptNet
  vocnet pipeline source download ecdict wordnet # Download ECDICT and WordNet
  vocnet pipeline source download wikidata # Download only Wikidata`,
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

// submitCmd submits a pipeline job for async processing
var submitCmd = &cobra.Command{
	Use:   "submit [term]",
	Short: "Submit a pipeline job for async processing",
	Long: `Submit a pipeline job. Supports:
  - Single word: pipeline submit <term>
  - File: pipeline submit --file words.txt
  - Built-in wordbook: pipeline submit --wordbook CEFR-A1

File formats:
  .txt  — one word per line (blank lines and # comments ignored)
  .json — JSON string array ["word1", "word2"]`,
	RunE: func(cmd *cobra.Command, args []string) error {
		language, _ := cmd.Flags().GetString("language")
		tier, _ := cmd.Flags().GetInt32("tier")
		file, _ := cmd.Flags().GetString("file")
		wb, _ := cmd.Flags().GetString("wordbook")
		name, _ := cmd.Flags().GetString("name")

		deps, err := newPipelineDeps()
		if err != nil {
			return err
		}
		defer deps.cleanup()

		ctx := context.Background()

		var jobs []*entity.PipelineJob
		var job *entity.PipelineJob

		switch {
		case file != "":
			terms, err := pipeline.ParseTermFile(file)
			if err != nil {
				return fmt.Errorf("parse file: %w", err)
			}
			jobs, err = deps.svc.SubmitTerms(ctx, name, terms, language, tier)
			if err != nil {
				return err
			}
		case wb != "":
			terms, wbName, err := resolveWordbook(wb)
			if err != nil {
				return err
			}
			if name == "" {
				name = wbName
			}
			jobs, err = deps.svc.SubmitTerms(ctx, name, terms, language, tier)
			if err != nil {
				return err
			}
		case len(args) > 0:
			job, err = deps.svc.SubmitWord(ctx, args[0], language, tier)
			if err != nil {
				return err
			}
			jobs = []*entity.PipelineJob{job}
		default:
			return fmt.Errorf("provide a term, --file, or --wordbook")
		}

		if len(jobs) == 1 {
			j := jobs[0]
			fmt.Printf("Job #%d created: %s \"%s\" (%d terms)\n",
				j.ID, j.JobType, j.Name, j.TotalTerms)
			fmt.Printf("Use \"vocnet pipeline job %d\" to check progress.\n", j.ID)
			return nil
		}

		fmt.Printf("%d jobs created.\n", len(jobs))
		fmt.Printf("First job ID: %d\n", jobs[0].ID)
		fmt.Printf("Use \"vocnet pipeline jobs\" to check progress.\n")
		return nil
	},
}

// jobsCmd lists pipeline jobs
var jobsCmd = &cobra.Command{
	Use:   "jobs",
	Short: "List pipeline jobs",
	RunE: func(cmd *cobra.Command, args []string) error {
		statusFlag, _ := cmd.Flags().GetString("status")

		deps, err := newPipelineDeps()
		if err != nil {
			return err
		}
		defer deps.cleanup()

		ctx := context.Background()

		var statusFilter *entity.JobStatus
		if statusFlag != "" {
			s := entity.JobStatus(strings.ToUpper(statusFlag))
			statusFilter = &s
		}

		jobs, err := deps.svc.ListJobs(ctx, statusFilter)
		if err != nil {
			return err
		}

		if len(jobs) == 0 {
			fmt.Println("No jobs found.")
			return nil
		}

		table := tablewriter.NewTable(os.Stdout)
		table.Header("ID", "TYPE", "STATUS", "PROGRESS", "STAGES", "NAME", "CREATED")
		for _, j := range jobs {
			progress := fmt.Sprintf("%d/%d", j.Processed+j.Skipped+j.Failed, j.TotalTerms)
			displayName := j.Name
			if len(displayName) > 30 {
				displayName = displayName[:27] + "..."
			}

			stages := "-"
			if j.JobType == entity.JobTypeSingleWord {
				sp, err := deps.svc.GetJobStageProgress(ctx, j)
				if err == nil && sp != nil {
					stages = sp.String()
				}
			}

			_ = table.Append([]string{
				strconv.FormatInt(j.ID, 10),
				string(j.JobType),
				string(j.Status),
				progress,
				stages,
				displayName,
				j.CreatedAt.Format("2006-01-02 15:04"),
			})
		}
		_ = table.Render()
		return nil
	},
}

// jobCmd shows details for a single pipeline job
var jobCmd = &cobra.Command{
	Use:   "job <id>",
	Short: "View pipeline job details",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id, err := strconv.ParseInt(args[0], 10, 64)
		if err != nil {
			return fmt.Errorf("invalid job ID: %w", err)
		}

		deps, err := newPipelineDeps()
		if err != nil {
			return err
		}
		defer deps.cleanup()

		ctx := context.Background()

		detail, err := deps.svc.GetJobDetail(ctx, id)
		if err != nil {
			return fmt.Errorf("get job: %w", err)
		}

		j := detail.Job
		fmt.Printf("Job #%d: %s\n", j.ID, j.Name)
		fmt.Printf("Type:      %s\n", j.JobType)
		fmt.Printf("Status:    %s\n", j.Status)
		fmt.Printf("Language:  %s\n", j.Language)
		fmt.Printf("Tier:      %d\n", j.Tier)
		fmt.Printf("Progress:  %d/%d processed, %d skipped, %d failed\n",
			j.Processed, j.TotalTerms, j.Skipped, j.Failed)
		fmt.Printf("Created:   %s\n", j.CreatedAt.Format("2006-01-02 15:04:05"))
		if j.StartedAt != nil {
			fmt.Printf("Started:   %s\n", j.StartedAt.Format("2006-01-02 15:04:05"))
		}
		if j.CompletedAt != nil {
			fmt.Printf("Completed: %s\n", j.CompletedAt.Format("2006-01-02 15:04:05"))
		}
		if j.StartedAt != nil && j.CompletedAt != nil {
			duration := j.CompletedAt.Sub(*j.StartedAt)
			fmt.Printf("Duration:  %s\n", duration.Truncate(100*time.Millisecond))
		}
		if j.ErrorMessage != "" {
			fmt.Printf("Error:     %s\n", j.ErrorMessage)
		}

		// Show stage details for single-word jobs
		if len(detail.Tasks) > 0 {
			fmt.Println("\nStages:")
			table := tablewriter.NewTable(os.Stdout)
			table.Header("PHASE", "NAME", "STATUS", "DURATION")
			for _, task := range detail.Tasks {
				phase := entity.PipelinePhase(task.Phase)
				dur := "-"
				if task.StartedAt != nil && task.CompletedAt != nil {
					dur = task.CompletedAt.Sub(*task.StartedAt).Truncate(100 * time.Millisecond).String()
				}
				_ = table.Append([]string{
					strconv.Itoa(int(task.Phase)),
					phase.Name(),
					string(task.Status),
					dur,
				})
				if task.ErrorMessage != "" {
					_ = table.Append([]string{"", "", fmt.Sprintf("  error: %s", task.ErrorMessage), ""})
				}
			}
			_ = table.Render()
		}

		return nil
	},
}

// jobControlCmd creates a cobra command for job control actions.
func jobControlCmd(use, short string, action entity.JobAction, pastTense string) *cobra.Command {
	return &cobra.Command{
		Use:   use + " <id>",
		Short: short,
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id, err := strconv.ParseInt(args[0], 10, 64)
			if err != nil {
				return fmt.Errorf("invalid job ID: %w", err)
			}

			deps, err := newPipelineDeps()
			if err != nil {
				return err
			}
			defer deps.cleanup()

			ctx := context.Background()
			if err := deps.svc.ControlJob(ctx, id, action); err != nil {
				return fmt.Errorf("%s job: %w", use, err)
			}

			fmt.Printf("Job #%d %s.\n", id, pastTense)
			return nil
		},
	}
}

// pipelineDeps bundles CLI dependencies for pipeline commands.
type pipelineDeps struct {
	svc     *pipeline.PipelineService
	cleanup func()
}

// newPipelineDeps creates the common dependencies for pipeline CLI commands.
func newPipelineDeps() (*pipelineDeps, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, fmt.Errorf("load config: %w", err)
	}

	logger, err := server.NewLogger(cfg)
	if err != nil {
		return nil, fmt.Errorf("create logger: %w", err)
	}

	entClient, cleanup, err := database.NewEntClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("create ent client: %w", err)
	}

	jobRepo := repository.NewPipelineJobRepository(entClient)
	taskRepo := repository.NewPipelineTaskRepository(entClient)
	lemmaRepo := repository.NewLemmaRepository(entClient)
	svc := pipeline.NewPipelineService(jobRepo, taskRepo, lemmaRepo, logger)

	return &pipelineDeps{svc: svc, cleanup: cleanup}, nil
}

// statsCmd shows pipeline worker pool statistics
var statsCmd = &cobra.Command{
	Use:   "stats",
	Short: "Show pipeline worker pool statistics",
	Long: `Query the running server's metrics endpoint to display:
  - Worker pool metrics (jobs processed, rate, avg duration)
  - Queue status (pending, running, completed, failed)
  - Estimated remaining time

The server must be running for this command to work.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		serverURL, _ := cmd.Flags().GetString("url")
		watch, _ := cmd.Flags().GetBool("watch")

		if watch {
			return runStatsWatch(serverURL)
		}
		return runStatsOnce(serverURL)
	},
}

func runStatsOnce(serverURL string) error {
	stats, err := fetchPipelineStats(serverURL)
	if err != nil {
		return err
	}
	printStats(stats)
	return nil
}

func runStatsWatch(serverURL string) error {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	// Print initial stats
	if err := runStatsOnce(serverURL); err != nil {
		return err
	}

	fmt.Println("\nWatching... (press Ctrl+C to stop)")

	for range ticker.C {
		// Clear screen and move cursor to top
		fmt.Print("\033[H\033[2J")
		if err := runStatsOnce(serverURL); err != nil {
			fmt.Printf("Error: %v\n", err)
		}
		fmt.Println("\nWatching... (press Ctrl+C to stop)")
	}
	return nil
}

// PipelineStatsResponse mirrors server.PipelineStatsResponse for CLI parsing.
type PipelineStatsResponse struct {
	Worker                    WorkerMetrics `json:"worker"`
	Queue                     QueueStats    `json:"queue"`
	EstimatedRemainingSeconds float64       `json:"estimated_remaining_seconds"`
}

type WorkerMetrics struct {
	UptimeSeconds       float64 `json:"uptime_seconds"`
	JobsProcessed       int64   `json:"jobs_processed"`
	JobsSucceeded       int64   `json:"jobs_succeeded"`
	JobsFailed          int64   `json:"jobs_failed"`
	JobsPerMinute       float64 `json:"jobs_per_minute"`
	AvgDurationMs       float64 `json:"avg_duration_ms"`
	RecentJobsPerMinute float64 `json:"recent_jobs_per_minute"`
	RecentAvgDurationMs float64 `json:"recent_avg_duration_ms"`
}

type QueueStats struct {
	Pending   int64 `json:"pending"`
	Running   int64 `json:"running"`
	Completed int64 `json:"completed"`
	Failed    int64 `json:"failed"`
	Paused    int64 `json:"paused"`
	Cancelled int64 `json:"cancelled"`
	Total     int64 `json:"total"`
}

func fetchPipelineStats(serverURL string) (*PipelineStatsResponse, error) {
	resp, err := http.Get(serverURL + "/metrics/pipeline")
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned status %d", resp.StatusCode)
	}

	var stats PipelineStatsResponse
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	return &stats, nil
}

func printStats(stats *PipelineStatsResponse) {
	now := time.Now().Format("2006-01-02 15:04:05")
	fmt.Printf("Pipeline Stats (%s)\n", now)
	fmt.Println(strings.Repeat("=", 50))

	// Worker metrics
	fmt.Println("\n📊 Worker Pool:")
	fmt.Printf("  Uptime:         %s\n", formatDuration(stats.Worker.UptimeSeconds))
	fmt.Printf("  Processed:      %d (✓ %d, ✗ %d)\n",
		stats.Worker.JobsProcessed, stats.Worker.JobsSucceeded, stats.Worker.JobsFailed)
	fmt.Printf("  Rate (5min):    %.1f jobs/min\n", stats.Worker.JobsPerMinute)
	fmt.Printf("  Rate (1min):    %.1f jobs/min\n", stats.Worker.RecentJobsPerMinute)
	fmt.Printf("  Avg Duration:   %.0f ms\n", stats.Worker.AvgDurationMs)

	// Queue stats
	fmt.Println("\n📋 Queue:")
	fmt.Printf("  Pending:        %d\n", stats.Queue.Pending)
	fmt.Printf("  Running:        %d\n", stats.Queue.Running)
	fmt.Printf("  Completed:      %d\n", stats.Queue.Completed)
	fmt.Printf("  Failed:         %d\n", stats.Queue.Failed)
	if stats.Queue.Paused > 0 {
		fmt.Printf("  Paused:         %d\n", stats.Queue.Paused)
	}
	if stats.Queue.Cancelled > 0 {
		fmt.Printf("  Cancelled:      %d\n", stats.Queue.Cancelled)
	}
	fmt.Printf("  Total:          %d\n", stats.Queue.Total)

	// Progress
	remaining := stats.Queue.Pending + stats.Queue.Running
	if stats.Queue.Total > 0 {
		completed := stats.Queue.Completed + stats.Queue.Failed + stats.Queue.Cancelled
		progress := float64(completed) / float64(stats.Queue.Total) * 100
		fmt.Printf("\n⏱️  Progress:      %.1f%% (%d/%d)\n", progress, completed, stats.Queue.Total)
	}

	// ETA
	if stats.EstimatedRemainingSeconds > 0 && remaining > 0 {
		fmt.Printf("🕐 ETA:           ~%s (%d jobs remaining)\n",
			formatDuration(stats.EstimatedRemainingSeconds), remaining)
	}
}

func formatDuration(seconds float64) string {
	d := time.Duration(seconds * float64(time.Second))
	if d < time.Minute {
		return d.Round(time.Second).String()
	}
	if d < time.Hour {
		mins := int(d.Minutes())
		secs := int(d.Seconds()) % 60
		return fmt.Sprintf("%dm%ds", mins, secs)
	}
	hours := int(d.Hours())
	mins := int(d.Minutes()) % 60
	return fmt.Sprintf("%dh%dm", hours, mins)
}

// resolveWordbook finds a builtin wordbook by name or ID and returns its terms.
func resolveWordbook(nameOrID string) ([]string, string, error) {
	builtins := wordbook.GetBuiltinWordbooks()

	// Try by ID
	if id, err := strconv.ParseInt(nameOrID, 10, 64); err == nil {
		for _, wb := range builtins {
			if wb.Id == id {
				return wb.Terms, wb.Name, nil
			}
		}
		return nil, "", fmt.Errorf("wordbook with ID %d not found", id)
	}

	// Try by name (case-insensitive)
	for _, wb := range builtins {
		if strings.EqualFold(wb.Name, nameOrID) {
			return wb.Terms, wb.Name, nil
		}
	}

	// List available
	var names []string
	for _, wb := range builtins {
		names = append(names, fmt.Sprintf("  %d: %s (%d terms)", wb.Id, wb.Name, len(wb.Terms)))
	}
	return nil, "", fmt.Errorf("wordbook %q not found. Available:\n%s", nameOrID, strings.Join(names, "\n"))
}

func init() {
	rootCmd.AddCommand(pipelineCmd)

	// Source management commands
	pipelineCmd.AddCommand(sourceCmd)
	sourceCmd.AddCommand(sourceListCmd, sourceDownloadCmd)

	// Async job commands
	pipelineCmd.AddCommand(submitCmd)
	submitCmd.Flags().String("language", "en", "Language code")
	submitCmd.Flags().Int32("tier", 2, "Priority tier (1=Core, 2=Extended, 3=LongTail)")
	submitCmd.Flags().String("file", "", "Path to term file (txt/json)")
	submitCmd.Flags().String("wordbook", "", "Built-in wordbook name or ID")
	submitCmd.Flags().String("name", "", "Custom job name")

	pipelineCmd.AddCommand(jobsCmd)
	jobsCmd.Flags().String("status", "", "Filter by status (PENDING, RUNNING, PAUSED, COMPLETED, FAILED, CANCELLED)")

	pipelineCmd.AddCommand(jobCmd)

	// Job control commands
	pipelineCmd.AddCommand(jobControlCmd("pause", "Pause a running or pending job", entity.JobActionPause, "paused"))
	pipelineCmd.AddCommand(jobControlCmd("resume", "Resume a paused job", entity.JobActionResume, "resumed"))
	pipelineCmd.AddCommand(jobControlCmd("cancel", "Cancel a pending, running, or paused job", entity.JobActionCancel, "cancelled"))
	pipelineCmd.AddCommand(jobControlCmd("retry", "Retry a failed or cancelled job", entity.JobActionRetry, "queued for retry"))

	// Stats command
	pipelineCmd.AddCommand(statsCmd)
	statsCmd.Flags().String("url", "http://localhost:8080", "Server URL")
	statsCmd.Flags().BoolP("watch", "w", false, "Watch mode (refresh every 2 seconds)")
}
