package mapping

import (
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	learningv1 "github.com/eslsoft/vocnet/pkg/api/learning/v1"
	wordbookv1 "github.com/eslsoft/vocnet/pkg/api/wordbook/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func ToEntityReviewPlan(pb *learningv1.ReviewPlan) *entity.ReviewPlan {
	if pb == nil {
		return nil
	}
	var createdAt, updatedAt time.Time
	if pb.GetCreatedAt() != nil {
		createdAt = pb.GetCreatedAt().AsTime()
	}
	if pb.GetUpdatedAt() != nil {
		updatedAt = pb.GetUpdatedAt().AsTime()
	}
	return &entity.ReviewPlan{
		ID:          pb.GetId(),
		Name:        pb.GetName(),
		Description: pb.GetDescription(),
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
	}
}

func ToPbReviewPlan(ent *entity.ReviewPlan) *learningv1.ReviewPlan {
	if ent == nil {
		return nil
	}

	out := &learningv1.ReviewPlan{
		Id:          ent.ID,
		Name:        ent.Name,
		Description: ent.Description,
		CreatedBy:   ent.UserID.String(),
		Status:      toPbReviewPlanStatus(&ent.Status),
	}
	if !ent.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(ent.CreatedAt)
	}
	if !ent.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(ent.UpdatedAt)
	}
	return out
}

func toPbReviewPlanStatus(status *entity.ReviewPlanStatus) *learningv1.ReviewPlanStatus {
	if status == nil {
		return &learningv1.ReviewPlanStatus{
			Wordbooks: []*wordbookv1.Wordbook{},
		}
	}

	wordbooks := make([]*wordbookv1.Wordbook, 0, len(status.Wordbooks))
	for _, wb := range status.Wordbooks {
		wordbooks = append(wordbooks, ToPbWordbook(wb))
	}

	return &learningv1.ReviewPlanStatus{
		PendingWords:  status.PendingWords,
		MasteredWords: status.MasteredWords,
		LearningWords: status.LearningWords,
		UnknownWords:  status.UnknownWords,
		Wordbooks:     wordbooks,
	}
}
