package connectrpc

import (
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	pipelinev1 "github.com/eslsoft/vocnet/pkg/api/pipeline/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func toPBPipelineJob(job *entity.PipelineJob) *pipelinev1.PipelineJob {
	if job == nil {
		return nil
	}
	return &pipelinev1.PipelineJob{
		Id:           job.ID,
		JobType:      toPBJobType(job.JobType),
		Status:       toPBJobStatus(job.Status),
		Name:         job.Name,
		Language:     job.Language,
		Tier:         job.Tier,
		Term:         job.Term,
		TotalTerms:   job.TotalTerms,
		Processed:    job.Processed,
		Skipped:      job.Skipped,
		Failed:       job.Failed,
		ErrorMessage: job.ErrorMessage,
		StartedAt:    toPBTimestamp(job.StartedAt),
		CompletedAt:  toPBTimestamp(job.CompletedAt),
		CreatedAt:    timestamppb.New(job.CreatedAt),
		UpdatedAt:    timestamppb.New(job.UpdatedAt),
	}
}

func toPBPipelineStage(stage *entity.PipelineTask) *pipelinev1.PipelineStage {
	if stage == nil {
		return nil
	}
	phase := entity.PipelinePhase(stage.Phase)
	return &pipelinev1.PipelineStage{
		Id:           stage.ID,
		JobId:        stage.JobID,
		LemmaId:      stage.LemmaID,
		Phase:        toPBPipelinePhase(phase),
		PhaseName:    phase.Name(),
		Status:       toPBStageStatus(stage.Status),
		Attempts:     stage.Attempts,
		ErrorMessage: stage.ErrorMessage,
		StartedAt:    toPBTimestamp(stage.StartedAt),
		CompletedAt:  toPBTimestamp(stage.CompletedAt),
		CreatedAt:    timestamppb.New(stage.CreatedAt),
		UpdatedAt:    timestamppb.New(stage.UpdatedAt),
	}
}

func toPBLemmaItem(lemma *entity.Lemma) *pipelinev1.LemmaItem {
	if lemma == nil {
		return nil
	}
	return &pipelinev1.LemmaItem{
		Id:         lemma.ID,
		Surface:    lemma.Surface,
		Normalized: lemma.Normalized,
		Level:      toPBLemmaLevel(lemma.Level),
		CreatedAt:  timestamppb.New(lemma.CreatedAt),
		UpdatedAt:  timestamppb.New(lemma.UpdatedAt),
	}
}

func toPBTimestamp(t *time.Time) *timestamppb.Timestamp {
	if t == nil {
		return nil
	}
	return timestamppb.New(*t)
}

func toPBJobType(t entity.JobType) pipelinev1.PipelineJobType {
	switch t {
	case entity.JobTypeSingleWord:
		return pipelinev1.PipelineJobType_PIPELINE_JOB_TYPE_SINGLE_WORD
	case entity.JobTypeWordbook:
		return pipelinev1.PipelineJobType_PIPELINE_JOB_TYPE_WORDBOOK
	default:
		return pipelinev1.PipelineJobType_PIPELINE_JOB_TYPE_UNSPECIFIED
	}
}

func toPBJobStatus(s entity.JobStatus) pipelinev1.PipelineJobStatus {
	switch s {
	case entity.JobStatusPending:
		return pipelinev1.PipelineJobStatus_PIPELINE_JOB_STATUS_PENDING
	case entity.JobStatusRunning:
		return pipelinev1.PipelineJobStatus_PIPELINE_JOB_STATUS_RUNNING
	case entity.JobStatusPaused:
		return pipelinev1.PipelineJobStatus_PIPELINE_JOB_STATUS_PAUSED
	case entity.JobStatusCompleted:
		return pipelinev1.PipelineJobStatus_PIPELINE_JOB_STATUS_COMPLETED
	case entity.JobStatusFailed:
		return pipelinev1.PipelineJobStatus_PIPELINE_JOB_STATUS_FAILED
	case entity.JobStatusCancelled:
		return pipelinev1.PipelineJobStatus_PIPELINE_JOB_STATUS_CANCELLED
	default:
		return pipelinev1.PipelineJobStatus_PIPELINE_JOB_STATUS_UNSPECIFIED
	}
}

func toEntityJobStatusPtr(s pipelinev1.PipelineJobStatus) *entity.JobStatus {
	v, ok := toEntityJobStatus(s)
	if !ok {
		return nil
	}
	return &v
}

func toEntityJobStatus(s pipelinev1.PipelineJobStatus) (entity.JobStatus, bool) {
	switch s {
	case pipelinev1.PipelineJobStatus_PIPELINE_JOB_STATUS_PENDING:
		return entity.JobStatusPending, true
	case pipelinev1.PipelineJobStatus_PIPELINE_JOB_STATUS_RUNNING:
		return entity.JobStatusRunning, true
	case pipelinev1.PipelineJobStatus_PIPELINE_JOB_STATUS_PAUSED:
		return entity.JobStatusPaused, true
	case pipelinev1.PipelineJobStatus_PIPELINE_JOB_STATUS_COMPLETED:
		return entity.JobStatusCompleted, true
	case pipelinev1.PipelineJobStatus_PIPELINE_JOB_STATUS_FAILED:
		return entity.JobStatusFailed, true
	case pipelinev1.PipelineJobStatus_PIPELINE_JOB_STATUS_CANCELLED:
		return entity.JobStatusCancelled, true
	default:
		return "", false
	}
}

func toPBPipelinePhase(p entity.PipelinePhase) pipelinev1.PipelinePhase {
	switch p {
	case entity.PhaseDiscovery:
		return pipelinev1.PipelinePhase_PIPELINE_PHASE_DISCOVERY
	case entity.PhaseLexical:
		return pipelinev1.PipelinePhase_PIPELINE_PHASE_LEXICAL
	case entity.PhaseRelational:
		return pipelinev1.PipelinePhase_PIPELINE_PHASE_RELATIONAL
	case entity.PhaseIntellectual:
		return pipelinev1.PipelinePhase_PIPELINE_PHASE_INTELLECTUAL
	case entity.PhaseSynthesis:
		return pipelinev1.PipelinePhase_PIPELINE_PHASE_SYNTHESIS
	default:
		return pipelinev1.PipelinePhase_PIPELINE_PHASE_UNSPECIFIED
	}
}

func toPBStageStatus(s entity.TaskStatus) pipelinev1.PipelineStageStatus {
	switch s {
	case entity.TaskStatusPending:
		return pipelinev1.PipelineStageStatus_PIPELINE_STAGE_STATUS_PENDING
	case entity.TaskStatusRunning:
		return pipelinev1.PipelineStageStatus_PIPELINE_STAGE_STATUS_RUNNING
	case entity.TaskStatusCompleted:
		return pipelinev1.PipelineStageStatus_PIPELINE_STAGE_STATUS_COMPLETED
	case entity.TaskStatusFailed:
		return pipelinev1.PipelineStageStatus_PIPELINE_STAGE_STATUS_FAILED
	case entity.TaskStatusSkipped:
		return pipelinev1.PipelineStageStatus_PIPELINE_STAGE_STATUS_SKIPPED
	default:
		return pipelinev1.PipelineStageStatus_PIPELINE_STAGE_STATUS_UNSPECIFIED
	}
}

func toPBLemmaLevel(level string) pipelinev1.LemmaLevel {
	switch strings.ToUpper(strings.TrimSpace(level)) {
	case "":
		return pipelinev1.LemmaLevel_LEMMA_LEVEL_UNSPECIFIED
	case "A1":
		return pipelinev1.LemmaLevel_LEMMA_LEVEL_A1
	case "A2":
		return pipelinev1.LemmaLevel_LEMMA_LEVEL_A2
	case "B1":
		return pipelinev1.LemmaLevel_LEMMA_LEVEL_B1
	case "B2":
		return pipelinev1.LemmaLevel_LEMMA_LEVEL_B2
	case "C1":
		return pipelinev1.LemmaLevel_LEMMA_LEVEL_C1
	case "C2":
		return pipelinev1.LemmaLevel_LEMMA_LEVEL_C2
	default:
		return pipelinev1.LemmaLevel_LEMMA_LEVEL_OTHER
	}
}
