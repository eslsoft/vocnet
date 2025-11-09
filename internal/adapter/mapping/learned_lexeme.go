package mapping

import (
	"strings"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/eslsoft/vocnet/internal/entity"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	learningv1 "github.com/eslsoft/vocnet/pkg/api/learning/v1"
)

func FromPbLearnedLexeme(in *learningv1.LearnedLexeme) *entity.LearnedLexeme {
	if in == nil {
		return nil
	}
	spec := in.GetSpec()
	status := in.GetStatus()
	return &entity.LearnedLexeme{
		ID:          in.GetId(),
		LexemeID:    in.GetLexemeId(),
		DisplayTerm: strings.TrimSpace(spec.GetDisplayTerm()),
		Language:    FromPbLanguage(spec.GetLanguage()),
		Tags:        append([]string{}, spec.GetTags()...),
		Note:        strings.TrimSpace(spec.GetNote()),
		Relations:   fromPbLearnedRelations(spec.GetRelations()),
		Mastery:     FromPbMastery(status.GetMastery()),
		Review:      FromPbReview(status.GetReviewTiming()),
		FormStatus:  FromPbFormStatusMap(status.GetFormStatus()),
		QueryCount:  status.GetQueryCount(),
		CreatedBy:   status.GetCreatedBy(),
		CreatedAt:   status.GetCreatedAt().AsTime(),
		UpdatedAt:   status.GetUpdatedAt().AsTime(),
	}
}

func ToPbLearnedLexeme(in *entity.LearnedLexeme) *learningv1.LearnedLexeme {
	if in == nil {
		return nil
	}
	return &learningv1.LearnedLexeme{
		Id:       in.ID,
		LexemeId: in.LexemeID,
		Spec:     toPbLearnedSpec(in),
		Status:   toPbLearnedStatus(in),
	}
}

func toPbLearnedSpec(in *entity.LearnedLexeme) *learningv1.LearnedLexemeSpec {
	return &learningv1.LearnedLexemeSpec{
		DisplayTerm: in.DisplayTerm,
		Language:    ToPbLanguage(in.Language),
		Tags:        append([]string{}, in.Tags...),
		Note:        in.Note,
		Relations:   toPbLearnedRelations(in.Relations),
	}
}

func toPbLearnedStatus(in *entity.LearnedLexeme) *learningv1.LearnedLexemeStatus {
	return &learningv1.LearnedLexemeStatus{
		Mastery:      ToPbMastery(in.Mastery),
		ReviewTiming: ToPbReview(in.Review),
		FormStatus:   ToPbFormStatusMap(in.FormStatus),
		QueryCount:   in.QueryCount,
		CreatedBy:    in.CreatedBy,
		CreatedAt:    timestamppb.New(in.CreatedAt),
		UpdatedAt:    timestamppb.New(in.UpdatedAt),
	}
}

func fromPbLearnedRelations(items []*learningv1.LearnedLexemeRelation) []entity.LearnedLexemeRelation {
	out := make([]entity.LearnedLexemeRelation, 0, len(items))
	for _, rel := range items {
		out = append(out, entity.LearnedLexemeRelation{
			Word:         strings.TrimSpace(rel.GetWord()),
			RelationType: int32(rel.GetRelationType()),
			Note:         strings.TrimSpace(rel.GetNote()),
			CreatedAt:    rel.GetCreatedAt().AsTime(),
			UpdatedAt:    rel.GetUpdatedAt().AsTime(),
		})
	}
	return out
}

func toPbLearnedRelations(items []entity.LearnedLexemeRelation) []*learningv1.LearnedLexemeRelation {
	out := make([]*learningv1.LearnedLexemeRelation, 0, len(items))
	for _, rel := range items {
		out = append(out, &learningv1.LearnedLexemeRelation{
			Word:         rel.Word,
			RelationType: commonv1.RelationType(rel.RelationType),
			Note:         rel.Note,
			CreatedAt:    timestamppb.New(rel.CreatedAt),
			UpdatedAt:    timestamppb.New(rel.UpdatedAt),
		})
	}
	return out
}

func FromPbFormStatusMap(items map[string]*learningv1.FormMastery) map[string]entity.FormMastery {
	if len(items) == 0 {
		return map[string]entity.FormMastery{}
	}
	out := make(map[string]entity.FormMastery, len(items))
	for key, value := range items {
		out[key] = entity.FormMastery{
			FormID:   value.GetFormId(),
			Strength: value.GetStrength(),
			Exposure: value.GetExposure(),
		}
	}
	return out
}

func ToPbFormStatusMap(items map[string]entity.FormMastery) map[string]*learningv1.FormMastery {
	if len(items) == 0 {
		return nil
	}
	out := make(map[string]*learningv1.FormMastery, len(items))
	for key, value := range items {
		out[key] = &learningv1.FormMastery{
			FormId:   value.FormID,
			Strength: value.Strength,
			Exposure: value.Exposure,
		}
	}
	return out
}

func FromPbMastery(in *learningv1.MasteryBreakdown) entity.MasteryBreakdown {
	return entity.MasteryBreakdown{
		Listen:    in.GetListen(),
		Read:      in.GetRead(),
		Spell:     in.GetSpell(),
		Pronounce: in.GetPronounce(),
		Overall:   in.GetOverall(),
	}
}

func ToPbMastery(in entity.MasteryBreakdown) *learningv1.MasteryBreakdown {
	return &learningv1.MasteryBreakdown{
		Listen:    in.Listen,
		Read:      in.Read,
		Spell:     in.Spell,
		Pronounce: in.Pronounce,
		Overall:   in.Overall,
	}
}

func ToPbReview(in entity.ReviewTiming) *learningv1.ReviewTiming {
	return &learningv1.ReviewTiming{
		LastReviewAt: timestamppb.New(in.LastReviewAt),
		NextReviewAt: timestamppb.New(in.NextReviewAt),
		IntervalDays: in.IntervalDays,
		FailCount:    in.FailCount,
	}
}

func FromPbReview(in *learningv1.ReviewTiming) entity.ReviewTiming {
	if in == nil {
		return entity.ReviewTiming{}
	}
	return entity.ReviewTiming{
		LastReviewAt: in.GetLastReviewAt().AsTime(),
		NextReviewAt: in.GetNextReviewAt().AsTime(),
		IntervalDays: in.GetIntervalDays(),
		FailCount:    in.GetFailCount(),
	}
}
