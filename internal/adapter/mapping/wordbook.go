package mapping

import (
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	wordbookv1 "github.com/eslsoft/vocnet/pkg/api/wordbook/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func ToEntityWordbook(pb *wordbookv1.Wordbook) *entity.Wordbook {
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
	stats := pb.GetStatus()
	if stats == nil {
		stats = &wordbookv1.WordbookStats{}
	}
	return &entity.Wordbook{
		ID:          pb.GetId(),
		Language:    FromPbLanguage(pb.GetLanguage()),
		Visibility:  fromPbWordbookVisibility(pb.GetVisibility()),
		Name:        pb.GetName(),
		Description: pb.GetDescription(),
		Annotations: copyStringMap(pb.GetAnnotations()),
		Terms:       append([]string{}, pb.GetTerms()...),
		Stats: entity.WordbookStats{
			TotalWords:    stats.GetTotalWords(),
			MasteredWords: stats.GetMasteredWords(),
			LearningWords: stats.GetLearningWords(),
			NewWords:      stats.GetUnknownWords(), // Map Unknown -> New
		},
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}
}

func ToPbWordbook(ent *entity.Wordbook) *wordbookv1.Wordbook {
	if ent == nil {
		return nil
	}

	status := &wordbookv1.WordbookStats{
		TotalWords:    ent.Stats.TotalWords,
		MasteredWords: ent.Stats.MasteredWords,
		LearningWords: ent.Stats.LearningWords,
		UnknownWords:  ent.Stats.NewWords, // Map New -> Unknown
	}
	if status.TotalWords == 0 {
		status.TotalWords = int32(len(ent.Terms))
	}

	ann := copyStringMap(ent.Annotations)
	if ann == nil {
		ann = map[string]string{}
	}
	if _, ok := ann["source"]; !ok && ent.Source != "" {
		ann["source"] = string(ent.Source)
	}

	out := &wordbookv1.Wordbook{
		Id:          ent.ID,
		Language:    ToPbLanguage(ent.Language),
		Visibility:  toPbWordbookVisibility(ent.Visibility),
		Name:        ent.Name,
		Description: ent.Description,
		Annotations: ann,
		Terms:       append([]string{}, ent.Terms...),
		Status:      status,
		CreatedBy:   ent.UserID.String(),
	}

	if !ent.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(ent.CreatedAt)
	}
	if !ent.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(ent.UpdatedAt)
	}

	return out
}

func copyStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func toPbWordbookVisibility(v entity.WordbookVisibility) wordbookv1.VisibilityType {
	switch v {
	case entity.WordbookVisibilityPrivate:
		return wordbookv1.VisibilityType_VISIBILITY_TYPE_PRIVATE
	case entity.WordbookVisibilityShared:
		return wordbookv1.VisibilityType_VISIBILITY_TYPE_SHARED
	case entity.WordbookVisibilityPublic:
		return wordbookv1.VisibilityType_VISIBILITY_TYPE_PUBLIC
	default:
		return wordbookv1.VisibilityType_VISIBILITY_TYPE_UNSPECIFIED
	}
}

func fromPbWordbookVisibility(v wordbookv1.VisibilityType) entity.WordbookVisibility {
	switch v {
	case wordbookv1.VisibilityType_VISIBILITY_TYPE_PRIVATE:
		return entity.WordbookVisibilityPrivate
	case wordbookv1.VisibilityType_VISIBILITY_TYPE_SHARED:
		return entity.WordbookVisibilityShared
	case wordbookv1.VisibilityType_VISIBILITY_TYPE_PUBLIC:
		return entity.WordbookVisibilityPublic
	default:
		return entity.WordbookVisibilityUnspecified
	}
}
