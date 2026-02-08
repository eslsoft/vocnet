package cmd

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/olekukonko/tablewriter"
	"github.com/spf13/cobra"

	"github.com/eslsoft/vocnet/internal/usecase/pipeline"
	pipelinev1 "github.com/eslsoft/vocnet/pkg/api/pipeline/v1"
	"github.com/eslsoft/vocnet/pkg/api/pipeline/v1/pipelinev1connect"
)

var pipelineServerURL string

var pipelineCmd = &cobra.Command{
	Use:   "pipeline",
	Short: "Vocabulary distillation pipeline operations",
}

func newPipelineClient() pipelinev1connect.PipelineServiceClient {
	httpClient := &http.Client{Timeout: 10 * time.Minute}
	return pipelinev1connect.NewPipelineServiceClient(httpClient, pipelineServerURL)
}

// Source management commands
var sourceCmd = &cobra.Command{
	Use:   "source",
	Short: "Manage offline data sources (ConceptNet, ECDICT, WordNet, Moby)",
}

var sourceListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all data sources and their status",
	RunE: func(cmd *cobra.Command, args []string) error {
		client := newPipelineClient()
		ctx := context.Background()

		resp, err := client.ListDataSources(ctx, connect.NewRequest(&pipelinev1.ListDataSourcesRequest{}))
		if err != nil {
			return fmt.Errorf("list data sources: %w", err)
		}

		fmt.Println("Pipeline Data Sources:")
		table := tablewriter.NewTable(os.Stdout)
		table.Header("STATUS", "SOURCE", "PATH", "INFO")
		var missing []string
		for _, s := range resp.Msg.GetSources() {
			symbol := "✗"
			info := "not found"
			if s.GetAvailable() {
				symbol = "✓"
				if s.GetSizeBytes() > 0 {
					info = fmt.Sprintf("%.1f MB", float64(s.GetSizeBytes())/(1024*1024))
				} else {
					info = "verified"
				}
			} else if s.GetErrorMessage() != "" {
				info = fmt.Sprintf("invalid: %s", s.GetErrorMessage())
			}

			_ = table.Append([]string{symbol, s.GetName(), s.GetPath(), info})
			if !s.GetAvailable() {
				missing = append(missing, strings.ToLower(s.GetName()))
			}
		}
		_ = table.Render()

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

Available sources: conceptnet, ecdict, wordnet, moby

Examples:
  vocnet pipeline source download            # Download all missing sources
  vocnet pipeline source download conceptnet # Download only ConceptNet
  vocnet pipeline source download ecdict wordnet # Download ECDICT and WordNet`,
	RunE: func(cmd *cobra.Command, args []string) error {
		client := newPipelineClient()
		ctx := context.Background()

		if len(args) == 0 {
			// Download all missing
			fmt.Println("Checking and downloading missing data sources...")
			_, err := client.DownloadDataSource(ctx, connect.NewRequest(&pipelinev1.DownloadDataSourceRequest{}))
			if err != nil {
				return fmt.Errorf("download missing: %w", err)
			}
			fmt.Println("\nAll data sources are now available.")
			return nil
		}

		// Download specific sources
		for _, source := range args {
			fmt.Printf("Downloading %s...\n", source)
			_, err := client.DownloadDataSource(ctx, connect.NewRequest(&pipelinev1.DownloadDataSourceRequest{
				Name: source,
			}))
			if err != nil {
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

		client := newPipelineClient()
		ctx := context.Background()

		req := &pipelinev1.SubmitJobRequest{
			Language: language,
			Tier:     tier,
			Name:     name,
		}

		switch {
		case file != "":
			terms, err := pipeline.ParseTermFile(file)
			if err != nil {
				return fmt.Errorf("parse file: %w", err)
			}
			req.Terms = terms
		case wb != "":
			req.WordbookName = wb
		case len(args) > 0:
			req.Term = args[0]
		default:
			return fmt.Errorf("provide a term, --file, or --wordbook")
		}

		resp, err := client.SubmitJob(ctx, connect.NewRequest(req))
		if err != nil {
			return err
		}

		job := resp.Msg
		fmt.Printf("Job #%d created: %s \"%s\" (%d terms)\n",
			job.GetId(), job.GetJobType(), job.GetName(), job.GetTotalTerms())
		fmt.Printf("Use \"vocnet pipeline job %d\" to check progress.\n", job.GetId())
		return nil
	},
}

// jobsCmd lists pipeline jobs
var jobsCmd = &cobra.Command{
	Use:   "jobs",
	Short: "List pipeline jobs",
	RunE: func(cmd *cobra.Command, args []string) error {
		statusFlag, _ := cmd.Flags().GetString("status")

		client := newPipelineClient()
		ctx := context.Background()

		resp, err := client.ListJobs(ctx, connect.NewRequest(&pipelinev1.ListJobsRequest{
			Status: statusFlag,
		}))
		if err != nil {
			return err
		}

		jobs := resp.Msg.GetJobs()
		if len(jobs) == 0 {
			fmt.Println("No jobs found.")
			return nil
		}

		table := tablewriter.NewTable(os.Stdout)
		table.Header("ID", "TYPE", "STATUS", "PROGRESS", "NAME", "CREATED")
		for _, j := range jobs {
			progress := fmt.Sprintf("%d/%d", j.GetProcessed()+j.GetSkipped()+j.GetFailed(), j.GetTotalTerms())
			displayName := j.GetName()
			if len(displayName) > 30 {
				displayName = displayName[:27] + "..."
			}
			createdAt := ""
			if j.GetCreatedAt() != nil {
				createdAt = j.GetCreatedAt().AsTime().Format("2006-01-02 15:04")
			}
			_ = table.Append([]string{
				strconv.FormatInt(j.GetId(), 10),
				j.GetJobType(),
				j.GetStatus(),
				progress,
				displayName,
				createdAt,
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

		client := newPipelineClient()
		ctx := context.Background()

		resp, err := client.GetJob(ctx, connect.NewRequest(&pipelinev1.GetJobRequest{Id: id}))
		if err != nil {
			return fmt.Errorf("get job: %w", err)
		}

		j := resp.Msg
		fmt.Printf("Job #%d: %s\n", j.GetId(), j.GetName())
		fmt.Printf("Type:      %s\n", j.GetJobType())
		fmt.Printf("Status:    %s\n", j.GetStatus())
		fmt.Printf("Language:  %s\n", j.GetLanguage())
		fmt.Printf("Tier:      %d\n", j.GetTier())
		fmt.Printf("Progress:  %d/%d processed, %d skipped, %d failed\n",
			j.GetProcessed(), j.GetTotalTerms(), j.GetSkipped(), j.GetFailed())
		if j.GetCreatedAt() != nil {
			fmt.Printf("Created:   %s\n", j.GetCreatedAt().AsTime().Format("2006-01-02 15:04:05"))
		}
		if j.GetStartedAt() != nil {
			fmt.Printf("Started:   %s\n", j.GetStartedAt().AsTime().Format("2006-01-02 15:04:05"))
		}
		if j.GetCompletedAt() != nil {
			fmt.Printf("Completed: %s\n", j.GetCompletedAt().AsTime().Format("2006-01-02 15:04:05"))
		}
		if j.GetStartedAt() != nil && j.GetCompletedAt() != nil {
			duration := j.GetCompletedAt().AsTime().Sub(j.GetStartedAt().AsTime())
			fmt.Printf("Duration:  %s\n", duration.Truncate(100*time.Millisecond))
		}
		if j.GetErrorMessage() != "" {
			fmt.Printf("Error:     %s\n", j.GetErrorMessage())
		}

		// Show stage details for single-word jobs via GetPipelineStatus
		if j.GetJobType() == "SINGLE_WORD" && j.GetTerm() != "" {
			term := j.GetTerm()
			{
				statusResp, err := client.GetPipelineStatus(ctx, connect.NewRequest(&pipelinev1.GetPipelineStatusRequest{
					Term:     term,
					Language: j.GetLanguage(),
				}))
				if err == nil && len(statusResp.Msg.GetPhases()) > 0 {
					fmt.Println("\nStages:")
					stageTable := tablewriter.NewTable(os.Stdout)
					stageTable.Header("PHASE", "NAME", "STATUS", "DURATION")
					for _, phase := range statusResp.Msg.GetPhases() {
						dur := "-"
						if phase.GetStartedAt() != nil && phase.GetCompletedAt() != nil {
							d := phase.GetCompletedAt().AsTime().Sub(phase.GetStartedAt().AsTime())
							dur = d.Truncate(100 * time.Millisecond).String()
						}
						_ = stageTable.Append([]string{
							strconv.Itoa(int(phase.GetPhase())),
							phase.GetName(),
							phase.GetStatus(),
							dur,
						})
						if phase.GetErrorMessage() != "" {
							_ = stageTable.Append([]string{"", "", fmt.Sprintf("  error: %s", phase.GetErrorMessage()), ""})
						}
					}
					_ = stageTable.Render()
				}
			}
		}

		return nil
	},
}

// cancelCmd cancels a pending or running pipeline job
var cancelCmd = &cobra.Command{
	Use:   "cancel <id>",
	Short: "Cancel a pending or running pipeline job",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		id, err := strconv.ParseInt(args[0], 10, 64)
		if err != nil {
			return fmt.Errorf("invalid job ID: %w", err)
		}

		client := newPipelineClient()
		ctx := context.Background()

		resp, err := client.CancelJob(ctx, connect.NewRequest(&pipelinev1.CancelJobRequest{Id: id}))
		if err != nil {
			return err
		}

		fmt.Printf("Job #%d cancelled (status: %s)\n", resp.Msg.GetId(), resp.Msg.GetStatus())
		return nil
	},
}

func init() {
	rootCmd.AddCommand(pipelineCmd)

	// Server URL flag on the pipeline command (inherited by subcommands)
	pipelineCmd.PersistentFlags().StringVar(&pipelineServerURL, "server", "http://localhost:8080", "Pipeline API server URL")

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
	jobsCmd.Flags().String("status", "", "Filter by status (PENDING, RUNNING, COMPLETED, FAILED)")

	pipelineCmd.AddCommand(jobCmd)
	pipelineCmd.AddCommand(cancelCmd)
}
