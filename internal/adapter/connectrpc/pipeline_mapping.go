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

func toPBPipelineStage(stage *entity.PipelineStage) *pipelinev1.PipelineStage {
	if stage == nil {
		return nil
	}
	phase := entity.PipelinePhase(stage.Phase)
	return &pipelinev1.PipelineStage{
		Id:           stage.ID,
		JobId:        stage.JobID,
		LemmaId:      stage.LemmaID,
		Phase:        toPBPipelinePhase(phase),
		Status:       toPBStatusFromStage(stage.Status),
		Attempts:     stage.Attempts,
		ErrorMessage: stage.ErrorMessage,
		StartedAt:    toPBTimestamp(stage.StartedAt),
		CompletedAt:  toPBTimestamp(stage.CompletedAt),
		CreatedAt:    timestamppb.New(stage.CreatedAt),
		UpdatedAt:    timestamppb.New(stage.UpdatedAt),
	}
}

func toPBLemmaFromSnapshot(snapshot *entity.WordSnapshot) *dictv1.Lemma {
	if snapshot == nil {
		return nil
	}
	lexemes := make([]*dictv1.Lexeme, 0, len(snapshot.Data.Lexemes))
	forms := make([]*dictv1.LemmaForm, 0)
	for _, lexeme := range snapshot.Data.Lexemes {
		lexemes = append(lexemes, toPBLexeme(lexeme))
		forms = append(forms, toPBLexemeForms(lexeme)...)
	}

	relations := make([]*dictv1.SemanticRelation, 0, len(snapshot.Data.Relations))
	for _, relation := range snapshot.Data.Relations {
		relations = append(relations, toPBSemanticRelation(relation))
	}

	return &dictv1.Lemma{
		Id:         snapshot.LemmaID,
		Surface:    snapshot.Term,
		Normalized: strings.ToLower(snapshot.Term),
		Forms:      forms,
		Lexemes:    lexemes,
		Relations:  relations,
		Qscore: &dictv1.QualityScore{
			Overall:      snapshot.QScore,
			Completeness: snapshot.QScoreCompleteness,
			Depth:        snapshot.QScoreDepth,
			Density:      snapshot.QScoreDensity,
			Validity:     snapshot.QScoreValidity,
		},
		CreatedAt: timestamppb.New(snapshot.CreatedAt),
		UpdatedAt: timestamppb.New(snapshot.UpdatedAt),
	}
}

func toPBLemmaSnapshot(snapshot *entity.WordSnapshot) *dictv1.LemmaSnapshot {
	if snapshot == nil {
		return nil
	}
	jobID := int64(0)
	if snapshot.JobID != nil {
		jobID = *snapshot.JobID
	}

	return &dictv1.LemmaSnapshot{
		Id:            snapshot.ID,
		LemmaId:       snapshot.LemmaID,
		Lemma:         toPBLemmaFromSnapshot(snapshot),
		Latest:        snapshot.Latest,
		Version:       snapshot.Version,
		JobId:         jobID,
		SynthesizedAt: timestamppb.New(snapshot.SynthesizedAt),
		CreatedAt:     timestamppb.New(snapshot.CreatedAt),
		UpdatedAt:     timestamppb.New(snapshot.UpdatedAt),
	}
}

func toPBLexeme(lexeme entity.SnapshotLexeme) *dictv1.Lexeme {
	senses := make([]*dictv1.LexemeSense, 0, len(lexeme.Senses))
	for _, sense := range lexeme.Senses {
		senses = append(senses, toPBLexemeSense(sense))
	}

	primaryGloss := ""
	for _, sense := range lexeme.Senses {
		if sense.Gloss != "" {
			primaryGloss = sense.Gloss
			break
		}
	}

	return &dictv1.Lexeme{
		Pos:          lexeme.POS,
		PrimaryGloss: primaryGloss,
		Senses:       senses,
	}
}

func toPBLexemeSense(sense entity.SnapshotSense) *dictv1.LexemeSense {
	return &dictv1.LexemeSense{
		Language: sense.Language,
		Gloss:    sense.Gloss,
		Examples: sense.Examples,
	}
}

func toPBLexemeForm(form entity.SnapshotForm) *dictv1.LemmaForm {
	return &dictv1.LemmaForm{
		Surface:   form.Surface,
		FormType:  form.FormType,
		Irregular: form.IsIrregular,
	}
}

func toPBLexemeForms(lexeme entity.SnapshotLexeme) []*dictv1.LemmaForm {
	forms := make([]*dictv1.LemmaForm, 0, len(lexeme.Forms))
	phonetics := make([]*dictv1.Phonetic, 0, len(lexeme.Phonetics))
	for _, phonetic := range lexeme.Phonetics {
		phonetics = append(phonetics, &dictv1.Phonetic{
			Ipa:     phonetic.IPA,
			Dialect: phonetic.Dialect,
		})
	}

	for _, form := range lexeme.Forms {
		pbForm := toPBLexemeForm(form)
		pbForm.Phonetics = phonetics
		forms = append(forms, pbForm)
	}

	return forms
}

func toPBSemanticRelation(relation entity.SnapshotRelation) *dictv1.SemanticRelation {
	return &dictv1.SemanticRelation{
		RelationType: relation.RelationType,
		TargetTerm:   relation.TargetTerm,
		TargetRef:    relation.TargetRef,
		Provider:     relation.Provider,
		Strength:     relation.Strength,
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

func toPBStatusFromStage(s entity.StageStatus) pipelinev1.PipelineStatus {
	switch s {
	case entity.StageStatusPending:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_PENDING
	case entity.StageStatusRunning:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_RUNNING
	case entity.StageStatusCompleted:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_COMPLETED
	case entity.StageStatusFailed:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_FAILED
	case entity.StageStatusSkipped:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_SKIPPED
	default:
		return pipelinev1.PipelineStatus_PIPELINE_STATUS_UNSPECIFIED
	}
}
