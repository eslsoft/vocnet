package mapping

import (
	"github.com/eslsoft/vocnet/internal/entity"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
	learningv1 "github.com/eslsoft/vocnet/pkg/api/learning/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ToPbFlashCard converts usecase FlashCard to protobuf FlashCard.
func ToPbFlashCard(card *entity.FlashCard) *learningv1.FlashCard {
	if card == nil {
		return nil
	}

	return &learningv1.FlashCard{
		Id:          card.ID,
		Annotations: card.Annotations,
		Type:        toPbCardType(card.Type),
		Difficulty:  card.Difficulty,
		Prompt:      card.Prompt,
		Question:    toPbCardQuestion(card.Question),
		Answer:      toPbCardAnswer(card.Answer),
		Options:     toPbCardItems(card.Options),
		LwordId:     card.LWordID,
	}
}

// ToPbFlashCardSet converts usecase FlashCardSet to protobuf FlashCardSet.
func ToPbFlashCardSet(set *entity.FlashCardSet) *learningv1.FlashCardSet {
	if set == nil {
		return &learningv1.FlashCardSet{}
	}

	cards := make([]*learningv1.FlashCard, 0, len(set.Cards))
	for _, card := range set.Cards {
		cards = append(cards, ToPbFlashCard(card))
	}

	return &learningv1.FlashCardSet{
		FlashCards: cards,
		Stats:      toPbFlashCardStats(set.Stats),
	}
}

// toPbCardType converts usecase CardType to protobuf CardType.
func toPbCardType(t entity.CardType) learningv1.CardType {
	switch t {
	case entity.CardTypeCHOICE:
		return learningv1.CardType_CARD_TYPE_CHOICE
	case entity.CardTypeSPELLING:
		return learningv1.CardType_CARD_TYPE_SPELLING
	case entity.CardTypeSELECT_WORDS:
		return learningv1.CardType_CARD_TYPE_SELECT_WORDS
	default:
		return learningv1.CardType_CARD_TYPE_UNSPECIFIED
	}
}

// toPbCardQuestion converts usecase CardQuestion to protobuf CardQuestion.
func toPbCardQuestion(q *entity.CardQuestion) *learningv1.CardQuestion {
	if q == nil {
		return nil
	}

	phonetics := make([]*dictv1.Phonetic, 0, len(q.Phonetics))
	for _, p := range q.Phonetics {
		phonetics = append(phonetics, &dictv1.Phonetic{
			Ipa:     p.IPA,
			Dialect: p.Dialect,
		})
	}

	return &learningv1.CardQuestion{
		Text:      q.Text,
		AutoPlay:  q.AutoPlay,
		Phonetics: phonetics,
		ImageUrl:  q.ImageURL,
	}
}

// toPbCardAnswer converts usecase CardAnswer to protobuf CardAnswer.
func toPbCardAnswer(a *entity.CardAnswer) *learningv1.CardAnswer {
	if a == nil {
		return nil
	}

	var config *learningv1.AnswerConfig
	if a.Config != nil {
		config = &learningv1.AnswerConfig{
			IgnoreCase: a.Config.IgnoreCase,
		}
	}

	return &learningv1.CardAnswer{
		CorrectValues: a.CorrectValues,
		Config:        config,
	}
}

// toPbCardItems converts usecase CardItems to protobuf CardItems.
func toPbCardItems(items []*entity.CardItem) []*learningv1.CardItem {
	if items == nil {
		return nil
	}

	result := make([]*learningv1.CardItem, 0, len(items))
	for _, item := range items {
		if item != nil {
			result = append(result, &learningv1.CardItem{
				Id:    item.ID,
				Text:  item.Text,
				Hint:  item.Hint,
				Group: item.Group,
			})
		}
	}
	return result
}

// toPbFlashCardStats converts usecase FlashCardStats to protobuf FlashCardStats.
func toPbFlashCardStats(stats *entity.FlashCardStats) *learningv1.FlashCardStats {
	if stats == nil {
		return &learningv1.FlashCardStats{}
	}

	return &learningv1.FlashCardStats{
		TodayDueTotal:      stats.TodayDueTotal,
		TodayNewTotal:      stats.TodayNewTotal,
		TodayDueRemaining:  stats.TodayDueRemaining,
		TodayNewRemaining:  stats.TodayNewRemaining,
		TodayReviewedCount: stats.TodayReviewedCount,
		EstimatedMinutes:   stats.EstimatedMinutes,
	}
}

// FromPbAnswerResult converts protobuf AnswerResult to usecase AnswerResult.
func FromPbAnswerResult(pb *learningv1.AnswerResult) *entity.AnswerResult {
	if pb == nil {
		return nil
	}

	return &entity.AnswerResult{
		LWordID:          pb.GetLwordId(),
		CardType:         fromPbCardType(pb.GetCardType()),
		Correct:          pb.GetCorrect(),
		Accuracy:         pb.GetAccuracy(),
		TimeSpentSeconds: pb.GetTimeSpentSeconds(),
		AnsweredAt:       pb.GetAnsweredAt().AsTime(),
	}
}

// fromPbCardType converts protobuf CardType to usecase CardType.
func fromPbCardType(t learningv1.CardType) entity.CardType {
	switch t {
	case learningv1.CardType_CARD_TYPE_CHOICE:
		return entity.CardTypeCHOICE
	case learningv1.CardType_CARD_TYPE_SPELLING:
		return entity.CardTypeSPELLING
	case learningv1.CardType_CARD_TYPE_SELECT_WORDS:
		return entity.CardTypeSELECT_WORDS
	default:
		return entity.CardTypeCHOICE
	}
}

// FromPbAnswerResults converts multiple protobuf AnswerResults.
func FromPbAnswerResults(pbResults []*learningv1.AnswerResult) []*entity.AnswerResult {
	if pbResults == nil {
		return nil
	}

	results := make([]*entity.AnswerResult, 0, len(pbResults))
	for _, pb := range pbResults {
		if pb != nil {
			results = append(results, FromPbAnswerResult(pb))
		}
	}
	return results
}

// ToPbAnswerResult converts usecase AnswerResult to protobuf (for testing).
func ToPbAnswerResult(result *entity.AnswerResult) *learningv1.AnswerResult {
	if result == nil {
		return nil
	}

	return &learningv1.AnswerResult{
		LwordId:          result.LWordID,
		CardType:         toPbCardType(result.CardType),
		Correct:          result.Correct,
		Accuracy:         result.Accuracy,
		TimeSpentSeconds: result.TimeSpentSeconds,
		AnsweredAt:       timestamppb.New(result.AnsweredAt),
	}
}
