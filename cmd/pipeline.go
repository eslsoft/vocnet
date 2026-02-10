package cmd

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/olekukonko/tablewriter"
	dto "github.com/prometheus/client_model/go"
	"github.com/prometheus/common/expfmt"
	"github.com/prometheus/common/model"
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
			fmt.Printf("Job #%d created: \"%s\"\n", j.ID, j.Name)
			fmt.Printf("Use \"vocnet pipeline job %d\" to check status.\n", j.ID)
			return nil
		}

		fmt.Printf("%d jobs created.\n", len(jobs))
		fmt.Printf("First job ID: %d\n", jobs[0].ID)
		fmt.Printf("Use \"vocnet pipeline jobs\" to check status.\n")
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
		table.Header("ID", "STATUS", "STAGES", "NAME", "CREATED")
		for _, j := range jobs {
			displayName := j.Name
			if len(displayName) > 30 {
				displayName = displayName[:27] + "..."
			}

			stages := "-"
			sp, err := deps.svc.GetJobStageProgress(ctx, j)
			if err == nil && sp != nil {
				stages = sp.String()
			}

			_ = table.Append([]string{
				strconv.FormatInt(j.ID, 10),
				string(j.Status),
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
		fmt.Printf("Status:    %s\n", j.Status)
		fmt.Printf("Language:  %s\n", j.Language)
		fmt.Printf("Tier:      %d\n", j.Tier)
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
		if len(detail.Stages) > 0 {
			fmt.Println("\nStages:")
			table := tablewriter.NewTable(os.Stdout)
			table.Header("PHASE", "NAME", "STATUS", "DURATION")
			for _, stage := range detail.Stages {
				phase := entity.PipelinePhase(stage.Phase)
				dur := "-"
				if stage.StartedAt != nil && stage.CompletedAt != nil {
					dur = stage.CompletedAt.Sub(*stage.StartedAt).Truncate(100 * time.Millisecond).String()
				}
				_ = table.Append([]string{
					strconv.Itoa(int(stage.Phase)),
					phase.Name(),
					string(stage.Status),
					dur,
				})
				if stage.ErrorMessage != "" {
					_ = table.Append([]string{"", "", fmt.Sprintf("  error: %s", stage.ErrorMessage), ""})
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
	stageRepo := repository.NewPipelineStageRepository(entClient)
	svc := pipeline.NewPipelineService(jobRepo, stageRepo, logger)

	return &pipelineDeps{svc: svc, cleanup: cleanup}, nil
}

// statsCmd shows pipeline worker pool statistics
var statsCmd = &cobra.Command{
	Use:   "stats",
	Short: "Show pipeline worker pool statistics",
	Long: `Query the running server's metrics endpoint to display worker pool metrics (uptime, jobs processed, rate, average duration).

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

// PipelineStats holds parsed Prometheus metrics for CLI display.
type PipelineStats struct {
	UptimeSeconds     float64
	JobsProcessed     float64
	JobsSucceeded     float64
	JobsFailed        float64
	PendingJobs       float64
	InFlightJobs      float64
	QueueTotal        float64
	WorkerUtilization float64
	JobsPerMinute     float64
	SuccessRate1m     float64
	ErrorRate1m       float64
	JobDurationSum    float64
	JobDurationCount  float64
}

func fetchPipelineStats(serverURL string) (*PipelineStats, error) {
	resp, err := http.Get(serverURL + "/metrics")
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned status %d", resp.StatusCode)
	}

	return parsePipelineStats(resp.Body)
}

func parsePipelineStats(r io.Reader) (*PipelineStats, error) {
	// Parse Prometheus text format using official parser
	parser := expfmt.NewTextParser(model.UTF8Validation)
	metricFamilies, err := parser.TextToMetricFamilies(r)
	if err != nil {
		return nil, fmt.Errorf("failed to parse metrics: %w", err)
	}

	stats := &PipelineStats{}

	stats.UptimeSeconds = getGaugeMetricValue(metricFamilies, "vocnet_pipeline_uptime_seconds")
	stats.JobsPerMinute = getGaugeMetricValue(metricFamilies, "vocnet_pipeline_jobs_per_minute")
	stats.PendingJobs = getGaugeMetricValue(metricFamilies, "vocnet_pipeline_pending_jobs")
	stats.InFlightJobs = getGaugeMetricValue(metricFamilies, "vocnet_pipeline_in_flight_jobs")
	stats.QueueTotal = getGaugeMetricValue(metricFamilies, "vocnet_pipeline_queue_total")
	stats.WorkerUtilization = getGaugeMetricValue(metricFamilies, "vocnet_pipeline_worker_utilization")
	stats.SuccessRate1m = getGaugeMetricValue(metricFamilies, "vocnet_pipeline_success_rate_1m")
	stats.ErrorRate1m = getGaugeMetricValue(metricFamilies, "vocnet_pipeline_error_rate_1m")
	stats.JobsSucceeded, stats.JobsFailed = getJobsProcessedByStatus(metricFamilies)
	stats.JobDurationSum, stats.JobDurationCount = getJobDurationStats(metricFamilies)

	return stats, nil
}

func getGaugeMetricValue(metricFamilies map[string]*dto.MetricFamily, metricName string) float64 {
	mf, ok := metricFamilies[metricName]
	if !ok {
		return 0
	}
	var value float64
	for _, m := range mf.GetMetric() {
		value = m.GetGauge().GetValue()
	}
	return value
}

func getJobsProcessedByStatus(metricFamilies map[string]*dto.MetricFamily) (succeeded float64, failed float64) {
	mf, ok := metricFamilies["vocnet_pipeline_jobs_processed_total"]
	if !ok {
		return 0, 0
	}
	for _, m := range mf.GetMetric() {
		for _, label := range m.GetLabel() {
			if label.GetName() != "status" {
				continue
			}
			switch label.GetValue() {
			case "succeeded":
				succeeded = m.GetCounter().GetValue()
			case "failed":
				failed = m.GetCounter().GetValue()
			}
		}
	}
	return succeeded, failed
}

func getJobDurationStats(metricFamilies map[string]*dto.MetricFamily) (sum float64, count float64) {
	mf, ok := metricFamilies["vocnet_pipeline_job_duration_seconds"]
	if !ok {
		return 0, 0
	}
	for _, m := range mf.GetMetric() {
		h := m.GetHistogram()
		sum = h.GetSampleSum()
		count = float64(h.GetSampleCount())
	}
	return sum, count
}

func printStats(stats *PipelineStats) {
	now := time.Now().Format("2006-01-02 15:04:05")
	fmt.Printf("Pipeline Stats (%s)\n", now)
	fmt.Println(strings.Repeat("=", 50))

	// Worker metrics
	fmt.Println("\n📊 Worker Pool:")
	fmt.Printf("  Uptime:         %s\n", formatDuration(stats.UptimeSeconds))

	total := int64(stats.JobsSucceeded + stats.JobsFailed)
	fmt.Printf("  Processed:      %d (✓ %.0f, ✗ %.0f)\n", total, stats.JobsSucceeded, stats.JobsFailed)
	fmt.Printf("  Queue:          total=%.0f, pending=%.0f, in-flight=%.0f\n", stats.QueueTotal, stats.PendingJobs, stats.InFlightJobs)
	fmt.Printf("  Utilization:    %.0f%%\n", stats.WorkerUtilization*100)

	jobsPerSec := stats.JobsPerMinute / 60.0
	fmt.Printf("  Rate:           %.1f jobs/min (%.2f jobs/sec)\n", stats.JobsPerMinute, jobsPerSec)
	fmt.Printf("  1m Health:      success=%.0f%%, error=%.0f%%\n", stats.SuccessRate1m*100, stats.ErrorRate1m*100)

	if stats.JobDurationCount > 0 {
		avgMs := (stats.JobDurationSum / stats.JobDurationCount) * 1000
		fmt.Printf("  Avg Duration:   %.0f ms\n", avgMs)
	}

	if stats.QueueTotal > 0 && stats.JobsPerMinute > 0 {
		etaSeconds := stats.QueueTotal / jobsPerSec
		fmt.Printf("  ETA:            %s\n", formatDuration(etaSeconds))
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
