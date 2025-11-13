package mapping

import (
	"strings"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/eslsoft/vocnet/internal/entity"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	learningv1 "github.com/eslsoft/vocnet/pkg/api/learning/v1"
)

func FromPbLearnedWord(in *learningv1.LearnedWord) *entity.LearnedWord {
	if in == nil {
		return nil
	}
	spec := in.GetSpec()
	status := in.GetStatus()
	return &entity.LearnedWord{
		ID:         in.GetId(),
		Term:       strings.TrimSpace(spec.GetTerm()),
		Language:   FromPbLanguage(spec.GetLanguage()),
		Tags:       append([]string{}, spec.GetTags()...),
		Relations:  fromPbLearnedWordRelations(spec.GetRelations()),
		Contexts:   fromPbLearnedWordContexts(spec.GetContexts()),
		Mastery:    FromPbMastery(status.GetMastery()),
		Review:     FromPbReview(status.GetReviewTiming()),
		QueryCount: status.GetQueriedCount(),
		CreatedBy:  status.GetCreatedBy(),
		CreatedAt:  status.GetCreatedAt().AsTime(),
		UpdatedAt:  status.GetUpdatedAt().AsTime(),
	}
}

func ToPbLearnedWord(in *entity.LearnedWord) *learningv1.LearnedWord {
	if in == nil {
		return nil
	}
	return &learningv1.LearnedWord{
		Id:     in.ID,
		Spec:   toPbLearnedWordSpec(in),
		Status: toPbLearnedWordStatus(in),
	}
}

func toPbLearnedWordSpec(in *entity.LearnedWord) *learningv1.LearnedWordSpec {
	return &learningv1.LearnedWordSpec{
		Term:      in.Term,
		Language:  ToPbLanguage(in.Language),
		Tags:      append([]string{}, in.Tags...),
		Relations: toPbLearnedWordRelations(in.Relations),
		Contexts:  toPbLearnedWordContexts(in.Contexts),
	}
}

func toPbLearnedWordStatus(in *entity.LearnedWord) *learningv1.LearnedWordStatus {
	return &learningv1.LearnedWordStatus{
		Mastery:      ToPbMastery(in.Mastery),
		ReviewTiming: ToPbReview(in.Review),
		QueriedWord:  in.Term,
		QueriedCount: in.QueryCount,
		CreatedBy:    in.CreatedBy,
		CreatedAt:    timestamppb.New(in.CreatedAt),
		UpdatedAt:    timestamppb.New(in.UpdatedAt),
	}
}

func fromPbLearnedWordRelations(items []*learningv1.LearnedWordRelation) []entity.LearnedWordRelation {
	out := make([]entity.LearnedWordRelation, 0, len(items))
	for _, rel := range items {
		out = append(out, entity.LearnedWordRelation{
			Word:         strings.TrimSpace(rel.GetWord()),
			RelationType: int32(rel.GetRelationType()),
			Note:         strings.TrimSpace(rel.GetNote()),
			CreatedAt:    rel.GetCreatedAt().AsTime(),
			UpdatedAt:    rel.GetUpdatedAt().AsTime(),
		})
	}
	return out
}

func toPbLearnedWordRelations(items []entity.LearnedWordRelation) []*learningv1.LearnedWordRelation {
	out := make([]*learningv1.LearnedWordRelation, 0, len(items))
	for _, rel := range items {
		out = append(out, &learningv1.LearnedWordRelation{
			Word:         rel.Word,
			RelationType: commonv1.RelationType(rel.RelationType),
			Note:         rel.Note,
			CreatedAt:    timestamppb.New(rel.CreatedAt),
			UpdatedAt:    timestamppb.New(rel.UpdatedAt),
		})
	}
	return out
}

func fromPbLearnedWordContexts(items []*learningv1.LearnedWordContext) []entity.LearnedWordContext {
	out := make([]entity.LearnedWordContext, 0, len(items))
	for _, ctx := range items {
		out = append(out, entity.LearnedWordContext{
			Sentence:    strings.TrimSpace(ctx.GetSentence()),
			Source:      int32(ctx.GetSource()),
			SourceRef:   strings.TrimSpace(ctx.GetSourceRef()),
			CollectedAt: ctx.GetCollectedAt().AsTime(),
		})
	}
	return out
}

func toPbLearnedWordContexts(items []entity.LearnedWordContext) []*learningv1.LearnedWordContext {
	out := make([]*learningv1.LearnedWordContext, 0, len(items))
	for _, ctx := range items {
		out = append(out, &learningv1.LearnedWordContext{
			Sentence:    ctx.Sentence,
			Source:      commonv1.SourceType(ctx.Source),
			SourceRef:   ctx.SourceRef,
			CollectedAt: timestamppb.New(ctx.CollectedAt),
		})
	}
	return out
}

// FromPbMastery converts protobuf MasteryBreakdown to entity.
func FromPbMastery(in *learningv1.MasteryBreakdown) entity.MasteryBreakdown {
	if in == nil {
		return entity.MasteryBreakdown{}
	}
	return entity.MasteryBreakdown{
		Listen:    in.GetListen(),
		Read:      in.GetRead(),
		Spell:     in.GetSpell(),
		Pronounce: in.GetPronounce(),
		Overall:   in.GetOverall(),
	}
}

// ToPbMastery converts entity MasteryBreakdown to protobuf.
func ToPbMastery(in entity.MasteryBreakdown) *learningv1.MasteryBreakdown {
	return &learningv1.MasteryBreakdown{
		Listen:    in.Listen,
		Read:      in.Read,
		Spell:     in.Spell,
		Pronounce: in.Pronounce,
		Overall:   in.Overall,
	}
}

// FromPbReview converts protobuf ReviewTiming to entity.
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

// ToPbReview converts entity ReviewTiming to protobuf.
func ToPbReview(in entity.ReviewTiming) *learningv1.ReviewTiming {
	return &learningv1.ReviewTiming{
		LastReviewAt: timestamppb.New(in.LastReviewAt),
		NextReviewAt: timestamppb.New(in.NextReviewAt),
		IntervalDays: in.IntervalDays,
		FailCount:    in.FailCount,
	}
}
