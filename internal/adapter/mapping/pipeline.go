package mapping

import (
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/infrastructure/datasource"
	pipelinev1 "github.com/eslsoft/vocnet/pkg/api/pipeline/v1"
	"github.com/samber/lo"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ---------------------------------------------------------------------------
// Job mapping
// ---------------------------------------------------------------------------

// ToPbPipelineJob converts an entity PipelineJob to its protobuf representation.
func ToPbPipelineJob(j *entity.PipelineJob) *pipelinev1.PipelineJob {
	if j == nil {
		return nil
	}
	pb := &pipelinev1.PipelineJob{
		Id:           j.ID,
		JobType:      string(j.JobType),
		Status:       string(j.Status),
		Name:         j.Name,
		Language:     j.Language,
		Tier:         j.Tier,
		TotalTerms:   j.TotalTerms,
		Processed:    j.Processed,
		Skipped:      j.Skipped,
		Failed:       j.Failed,
		ErrorMessage: j.ErrorMessage,
		CreatedAt:    timestamppb.New(j.CreatedAt),
	}
	if j.StartedAt != nil {
		pb.StartedAt = timestamppb.New(*j.StartedAt)
	}
	if j.CompletedAt != nil {
		pb.CompletedAt = timestamppb.New(*j.CompletedAt)
	}
	return pb
}

// ---------------------------------------------------------------------------
// Pipeline status mapping
// ---------------------------------------------------------------------------

// ToPbPipelineStatus converts a lemma and tasks to PipelineStatus.
func ToPbPipelineStatus(lemma *entity.Lemma, tasks []*entity.PipelineTask) *pipelinev1.PipelineStatus {
	pb := &pipelinev1.PipelineStatus{
		LemmaId: lemma.ID,
		Term:    lemma.Surface,
		Phases: lo.Map(tasks, func(t *entity.PipelineTask, _ int) *pipelinev1.PhaseStatus {
			return ToPbPhaseStatus(t)
		}),
	}
	return pb
}

// ToPbPhaseStatus converts a PipelineTask to its protobuf PhaseStatus.
func ToPbPhaseStatus(t *entity.PipelineTask) *pipelinev1.PhaseStatus {
	if t == nil {
		return nil
	}
	ps := &pipelinev1.PhaseStatus{
		Phase:        t.Phase,
		Name:         entity.PipelinePhase(t.Phase).Name(),
		Status:       string(t.Status),
		Attempts:     t.Attempts,
		ErrorMessage: t.ErrorMessage,
	}
	if t.StartedAt != nil {
		ps.StartedAt = timestamppb.New(*t.StartedAt)
	}
	if t.CompletedAt != nil {
		ps.CompletedAt = timestamppb.New(*t.CompletedAt)
	}
	return ps
}

// ---------------------------------------------------------------------------
// Snapshot mapping
// ---------------------------------------------------------------------------

// ToPbWordSnapshot converts an entity WordSnapshot to its protobuf representation.
func ToPbWordSnapshot(s *entity.WordSnapshot) *pipelinev1.WordSnapshotResponse {
	if s == nil {
		return nil
	}
	pb := &pipelinev1.WordSnapshotResponse{
		Term:        s.Term,
		Language:    s.Language,
		WikidataQid: s.WikidataQID,
		Version:     s.Version,
		Qscore: &pipelinev1.QualityScore{
			Overall:      s.QScore,
			Completeness: s.QScoreCompleteness,
			Depth:        s.QScoreDepth,
			Density:      s.QScoreDensity,
			Validity:     s.QScoreValidity,
		},
		SynthesizedAt: timestamppb.New(s.SynthesizedAt),
	}

	// Map lexemes
	pb.Lexemes = lo.Map(s.Data.Lexemes, func(l entity.SnapshotLexeme, _ int) *pipelinev1.SnapshotLexeme {
		return &pipelinev1.SnapshotLexeme{
			Pos: l.POS,
			Senses: lo.Map(l.Senses, func(se entity.SnapshotSense, _ int) *pipelinev1.SnapshotSense {
				return &pipelinev1.SnapshotSense{
					Language:    se.Language,
					Gloss:       se.Gloss,
					Examples:    se.Examples,
					Provider:    se.Provider,
					TrustWeight: se.TrustWeight,
				}
			}),
			Forms: lo.Map(l.Forms, func(f entity.SnapshotForm, _ int) *pipelinev1.SnapshotForm {
				return &pipelinev1.SnapshotForm{
					Surface:     f.Surface,
					FormType:    f.FormType,
					IsIrregular: f.IsIrregular,
				}
			}),
			Phonetics: lo.Map(l.Phonetics, func(p entity.Phonetic, _ int) *pipelinev1.Phonetic {
				return &pipelinev1.Phonetic{
					Ipa:     p.IPA,
					Dialect: p.Dialect,
				}
			}),
		}
	})

	// Map relations
	pb.Relations = lo.Map(s.Data.Relations, func(r entity.SnapshotRelation, _ int) *pipelinev1.SnapshotRelation {
		return &pipelinev1.SnapshotRelation{
			RelationType: r.RelationType,
			TargetTerm:   r.TargetTerm,
			Provider:     r.Provider,
			Strength:     r.Strength,
			SenseMapped:  r.SenseMapped,
		}
	})

	return pb
}

// ---------------------------------------------------------------------------
// Evidence mapping
// ---------------------------------------------------------------------------

// ToPbEvidence converts an entity RawEvidence to its protobuf representation.
func ToPbEvidence(e *entity.RawEvidence) *pipelinev1.Evidence {
	if e == nil {
		return nil
	}
	pb := &pipelinev1.Evidence{
		Id:            e.ID,
		Provider:      e.Provider,
		Phase:         e.Phase,
		SchemaVersion: e.SchemaVersion,
		FetchedAt:     timestamppb.New(e.FetchedAt),
	}

	// Convert map[string]any to protobuf Struct
	if e.Content != nil {
		if s, err := structpb.NewStruct(e.Content); err == nil {
			pb.Content = s
		}
	}

	return pb
}

// ---------------------------------------------------------------------------
// Data source mapping
// ---------------------------------------------------------------------------

// ToPbDataSourceStatus converts a datasource.Status to its protobuf representation.
func ToPbDataSourceStatus(s datasource.Status) *pipelinev1.DataSourceStatus {
	return &pipelinev1.DataSourceStatus{
		Name:         s.Name,
		Path:         s.Path,
		Available:    s.Available,
		SizeBytes:    s.Size,
		ErrorMessage: s.ErrorMsg,
	}
}
