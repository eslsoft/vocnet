package connectrpc

import (
	"strings"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
	pipelinev1 "github.com/eslsoft/vocnet/pkg/api/pipeline/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func toPBPipelineJob(job *entity.PipelineJob) *pipelinev1.PipelineJob {
	if job == nil {
		return nil
	}
	return &pipelinev1.PipelineJob{
		Id:           job.ID,
		Status:       toPBStatus(job.Status),
		Name:         job.Name,
		Language:     job.Language,
		Tier:         job.Tier,
		Term:         job.Term,
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
		Status:       toPBStatusFromTask(stage.Status),
		Attempts:     stage.Attempts,
		ErrorMessage: stage.ErrorMessage,
		StartedAt:    toPBTimestamp(stage.StartedAt),
		CompletedAt:  toPBTimestamp(stage.CompletedAt),
		CreatedAt:    timestamppb.New(stage.CreatedAt),
		UpdatedAt:    timestamppb.New(stage.UpdatedAt),
	}
}

func toPBLemma(lemma *entity.Lemma, snapshot *entity.WordSnapshot) *dictv1.Lemma {
	if lemma == nil {
		return nil
	}
	out := &dictv1.Lemma{
		Id:         lemma.ID,
		Surface:    lemma.Surface,
		Normalized: lemma.Normalized,
		Level:      toPBLemmaLevel(lemma.Level),
		CreatedAt:  timestamppb.New(lemma.CreatedAt),
		UpdatedAt:  timestamppb.New(lemma.UpdatedAt),
	}
	if snapshot == nil {
		return out
	}

	out.SnapshotId = &snapshot.ID
	out.SnapshotJobId = snapshot.JobID
	out.SnapshotTerm = snapshot.Term
	out.SnapshotTerms = snapshot.Terms
	out.SnapshotLanguage = snapshot.Language
	out.SnapshotLatest = snapshot.Latest
	out.SnapshotVersion = snapshot.Version
	out.SnapshotData = toPBLemmaData(snapshot.Data)
	out.SnapshotQScore = snapshot.QScore
	out.SnapshotQScoreCompleteness = snapshot.QScoreCompleteness
	out.SnapshotQScoreDepth = snapshot.QScoreDepth
	out.SnapshotQScoreDensity = snapshot.QScoreDensity
	out.SnapshotQScoreValidity = snapshot.QScoreValidity
	out.SnapshotSynthesizedAt = timestamppb.New(snapshot.SynthesizedAt)
	out.SnapshotCreatedAt = timestamppb.New(snapshot.CreatedAt)
	out.SnapshotUpdatedAt = timestamppb.New(snapshot.UpdatedAt)

	return out
}

func toPBLemmaData(data entity.SnapshotData) *dictv1.LemmaData {
	lexemes := make([]*dictv1.Lexeme, 0, len(data.Lexemes))
	for _, lexeme := range data.Lexemes {
		lexemes = append(lexemes, toPBLexeme(lexeme))
	}

	relations := make([]*dictv1.SemanticRelation, 0, len(data.Relations))
	for _, relation := range data.Relations {
		relations = append(relations, toPBSemanticRelation(relation))
	}

	return &dictv1.LemmaData{
		Lexemes:   lexemes,
		Relations: relations,
	}
}

func toPBLexeme(lexeme entity.SnapshotLexeme) *dictv1.Lexeme {
	senses := make([]*dictv1.LexemeSense, 0, len(lexeme.Senses))
	for _, sense := range lexeme.Senses {
		senses = append(senses, toPBLexemeSense(sense))
	}

	forms := make([]*dictv1.LemmaForm, 0, len(lexeme.Forms))
	for _, form := range lexeme.Forms {
		forms = append(forms, toPBLexemeForm(form))
	}

	phonetics := make([]*dictv1.Phonetic, 0, len(lexeme.Phonetics))
	for _, phonetic := range lexeme.Phonetics {
		phonetics = append(phonetics, toPBLexemePhonetic(phonetic))
	}

	return &dictv1.Lexeme{
		Pos:       lexeme.POS,
		Senses:    senses,
		Forms:     forms,
		Phonetics: phonetics,
	}
}

func toPBLexemeSense(sense entity.SnapshotSense) *dictv1.LexemeSense {
	return &dictv1.LexemeSense{
		Language:    sense.Language,
		Gloss:       sense.Gloss,
		Examples:    sense.Examples,
		Provider:    sense.Provider,
		TrustWeight: sense.TrustWeight,
	}
}

func toPBLexemeForm(form entity.SnapshotForm) *dictv1.LemmaForm {
	return &dictv1.LemmaForm{
		Surface:     form.Surface,
		FormType:    form.FormType,
		IsIrregular: form.IsIrregular,
	}
}

func toPBLexemePhonetic(phonetic entity.Phonetic) *dictv1.Phonetic {
	return &dictv1.Phonetic{
		Ipa:     phonetic.IPA,
		Dialect: phonetic.Dialect,
	}
}

func toPBSemanticRelation(relation entity.SnapshotRelation) *dictv1.SemanticRelation {
	return &dictv1.SemanticRelation{
		RelationType:   relation.RelationType,
		TargetTerm:     relation.TargetTerm,
		TargetRef:      relation.TargetRef,
		Provider:       relation.Provider,
		Strength:       relation.Strength,
		SenseMapped:    relation.SenseMapped,
		TargetResolved: relation.TargetResolved,
	}
}

func toPBTimestamp(t *time.Time) *timestamppb.Timestamp {
	if t == nil {
		return nil
	}
	return timestamppb.New(*t)
}

func toPBStatus(s entity.JobStatus) pipelinev1.PipelineStatus {
	switch s {
	case entity.JobStatusPending:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_PENDING
	case entity.JobStatusRunning:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_RUNNING
	case entity.JobStatusPaused:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_PAUSED
	case entity.JobStatusCompleted:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_COMPLETED
	case entity.JobStatusFailed:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_FAILED
	case entity.JobStatusCancelled:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_CANCELLED
	default:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_UNSPECIFIED
	}
}

func toEntityJobStatusPtr(s pipelinev1.PipelineStatus) *entity.JobStatus {
	v, ok := toEntityJobStatus(s)
	if !ok {
		return nil
	}
	return &v
}

func toEntityJobStatus(s pipelinev1.PipelineStatus) (entity.JobStatus, bool) {
	switch s {
	case pipelinev1.PipelineStatus_PIPELINE_STATUS_PENDING:
		return entity.JobStatusPending, true
	case pipelinev1.PipelineStatus_PIPELINE_STATUS_RUNNING:
		return entity.JobStatusRunning, true
	case pipelinev1.PipelineStatus_PIPELINE_STATUS_PAUSED:
		return entity.JobStatusPaused, true
	case pipelinev1.PipelineStatus_PIPELINE_STATUS_COMPLETED:
		return entity.JobStatusCompleted, true
	case pipelinev1.PipelineStatus_PIPELINE_STATUS_FAILED:
		return entity.JobStatusFailed, true
	case pipelinev1.PipelineStatus_PIPELINE_STATUS_CANCELLED:
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

func toPBStatusFromTask(s entity.TaskStatus) pipelinev1.PipelineStatus {
	switch s {
	case entity.TaskStatusPending:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_PENDING
	case entity.TaskStatusRunning:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_RUNNING
	case entity.TaskStatusCompleted:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_COMPLETED
	case entity.TaskStatusFailed:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_FAILED
	case entity.TaskStatusSkipped:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_SKIPPED
	default:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_UNSPECIFIED
	}
}

func toPBLemmaLevel(level string) dictv1.LemmaLevel {
	switch strings.ToUpper(strings.TrimSpace(level)) {
	case "":
		return dictv1.LemmaLevel_LEMMA_LEVEL_UNSPECIFIED
	case "A1":
		return dictv1.LemmaLevel_LEMMA_LEVEL_A1
	case "A2":
		return dictv1.LemmaLevel_LEMMA_LEVEL_A2
	case "B1":
		return dictv1.LemmaLevel_LEMMA_LEVEL_B1
	case "B2":
		return dictv1.LemmaLevel_LEMMA_LEVEL_B2
	case "C1":
		return dictv1.LemmaLevel_LEMMA_LEVEL_C1
	case "C2":
		return dictv1.LemmaLevel_LEMMA_LEVEL_C2
	default:
		return dictv1.LemmaLevel_LEMMA_LEVEL_UNSPECIFIED
	}
}
