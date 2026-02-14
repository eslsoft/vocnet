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
	return &pipelinev1.PipelineStage{
		Id:           stage.ID,
		JobId:        stage.JobID,
		LemmaId:      stage.LemmaID,
		Phase:        toPBPipelinePhase(stage.Phase),
		Status:       toPBStatusFromStage(stage.Status),
		Attempts:     stage.Attempts,
		ErrorMessage: stage.ErrorMessage,
		StartedAt:    toPBTimestamp(stage.StartedAt),
		CompletedAt:  toPBTimestamp(stage.CompletedAt),
		CreatedAt:    timestamppb.New(stage.CreatedAt),
		UpdatedAt:    timestamppb.New(stage.UpdatedAt),
	}
}

func toPBLemmaFromSnapshot(snapshot *entity.LemmaSnapshot) *dictv1.Lemma {
	if snapshot == nil {
		return nil
	}
	lexemes := make([]*dictv1.Lexeme, 0, len(snapshot.Payload.Lexemes))
	forms := make([]*dictv1.LemmaForm, 0, len(snapshot.Payload.Forms))
	for _, lexeme := range snapshot.Payload.Lexemes {
		lexemes = append(lexemes, toPBLexeme(lexeme))
	}
	for _, form := range snapshot.Payload.Forms {
		pbForm := toPBLemmaForm(form)
		pbForm.Phonetics = toPBPhonetics(form.Phonetics)
		forms = append(forms, pbForm)
	}

	relations := make([]*dictv1.SemanticRelation, 0, len(snapshot.Payload.Relations))
	for _, relation := range snapshot.Payload.Relations {
		relations = append(relations, toPBSemanticRelation(relation))
	}

	return &dictv1.Lemma{
		Id:          snapshot.LemmaID,
		Surface:     snapshot.Surface,
		Normalized:  snapshot.Normalized,
		Level:       toPBLemmaLevel(snapshot.Level),
		Forms:       forms,
		Lexemes:     lexemes,
		Frequencies: toPBFrequencies(snapshot.Payload.Frequencies),
		Relations:   relations,
		Qscore: &dictv1.QualityScore{
			Overall:      snapshot.Quality.Overall,
			Completeness: snapshot.Quality.Completeness,
			Depth:        snapshot.Quality.Depth,
			Density:      snapshot.Quality.Density,
			Validity:     snapshot.Quality.Validity,
		},
		CreatedAt: timestamppb.New(snapshot.CreatedAt),
		UpdatedAt: timestamppb.New(snapshot.UpdatedAt),
	}
}

func toPBLemmaLevel(level string) dictv1.LemmaLevel {
	switch strings.ToUpper(strings.TrimSpace(level)) {
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

func toPBLemmaSnapshot(snapshot *entity.LemmaSnapshot) *dictv1.LemmaSnapshot {
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
		Latest:        snapshot.IsLatest,
		Version:       snapshot.Version,
		JobId:         jobID,
		SynthesizedAt: timestamppb.New(snapshot.SynthesizedAt),
		CreatedAt:     timestamppb.New(snapshot.CreatedAt),
		UpdatedAt:     timestamppb.New(snapshot.UpdatedAt),
	}
}

func toPBFrequencies(frequencies []entity.Frequency) []*dictv1.Frequency {
	out := make([]*dictv1.Frequency, 0, len(frequencies))
	for _, frequency := range frequencies {
		out = append(out, &dictv1.Frequency{
			Corpus: frequency.Corpus,
			Count:  frequency.Count,
		})
	}
	return out
}

func toPBLexeme(lexeme entity.LemmaSnapshotLexeme) *dictv1.Lexeme {
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
		Id:           lexeme.ExternalID,
		Pos:          lexeme.POS,
		PrimaryGloss: primaryGloss,
		Senses:       senses,
	}
}

func toPBLexemeSense(sense entity.LemmaSnapshotSense) *dictv1.LexemeSense {
	return &dictv1.LexemeSense{
		Language: sense.Language,
		Gloss:    sense.Gloss,
		Examples: sense.Examples,
	}
}

func toPBLemmaForm(form entity.LemmaSnapshotForm) *dictv1.LemmaForm {
	return &dictv1.LemmaForm{
		Surface:   form.Surface,
		FormType:  form.FormType,
		Irregular: form.IsIrregular,
		Syllables: form.Syllables,
	}
}

func toPBPhonetics(phonetics []entity.Phonetic) []*dictv1.Phonetic {
	out := make([]*dictv1.Phonetic, 0, len(phonetics))
	for _, phonetic := range phonetics {
		out = append(out, &dictv1.Phonetic{
			Ipa:     phonetic.IPA,
			Dialect: phonetic.Dialect,
		})
	}
	return out
}

func toPBSemanticRelation(relation entity.LemmaSnapshotRelation) *dictv1.SemanticRelation {
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

func toPBPipelinePhase(stageNumber int32) pipelinev1.PipelinePhase {
	switch stageNumber {
	case 1, 2: // Collection (including LLM enrichment)
		return pipelinev1.PipelinePhase_PIPELINE_PHASE_COLLECTION
	case 3:
		return pipelinev1.PipelinePhase_PIPELINE_PHASE_EVALUATION
	case 4:
		return pipelinev1.PipelinePhase_PIPELINE_PHASE_INTEGRATION
	case 5:
		return pipelinev1.PipelinePhase_PIPELINE_PHASE_SNAPSHOT
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
