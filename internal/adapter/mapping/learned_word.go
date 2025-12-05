package mapping

import (
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/eslsoft/vocnet/internal/entity"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	learningv1 "github.com/eslsoft/vocnet/pkg/api/learning/v1"
)

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
		Term:     in.Term,
		Language: ToPbLanguage(in.Language),
		Tags:     append([]string{}, in.Tags...),
		Contexts: toPbLearnedWordContexts(in.Contexts),
	}
}

func toPbLearnedWordStatus(in *entity.LearnedWord) *learningv1.LearnedWordStatus {
	return &learningv1.LearnedWordStatus{
		Mastery:      ToPbMastery(in.Mastery),
		ReviewTiming: ToPbReview(in.Review),
		MatchedTerms: append([]string{}, in.MatchedTerms...),
		QueriedCount: in.QueriedCount,
		CreatedBy:    in.CreatedBy,
		CreatedAt:    timestamppb.New(in.CreatedAt),
		UpdatedAt:    timestamppb.New(in.UpdatedAt),
	}
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
		Listen:    in.GetListening(),
		Read:      in.GetReading(),
		Spell:     in.GetSpelling(),
		Pronounce: in.GetSpeaking(),
		Overall:   in.GetOverall(),
	}
}

// ToPbMastery converts entity MasteryBreakdown to protobuf.
func ToPbMastery(in entity.MasteryBreakdown) *learningv1.MasteryBreakdown {
	return &learningv1.MasteryBreakdown{
		Listening: in.Listen,
		Reading:   in.Read,
		Spelling:  in.Spell,
		Speaking:  in.Pronounce,
		Overall:   in.Overall,
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
