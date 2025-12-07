package connectrpc

import (
	"connectrpc.com/connect"

	"github.com/eslsoft/vocnet/internal/entity"
	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
	wordbookv1 "github.com/eslsoft/vocnet/pkg/api/wordbook/v1"
)

func extractID(req *connect.Request[commonv1.IDRequest], invalidErr error) (int64, error) {
	if req == nil || req.Msg == nil || req.Msg.GetId() == 0 {
		return 0, invalidErr
	}
	return req.Msg.GetId(), nil
}

func extractWordbookAction(req *connect.Request[wordbookv1.WordsActionRequest]) (int64, []string, error) {
	if req == nil || req.Msg == nil || req.Msg.GetWordbookId() == 0 {
		return 0, nil, entity.ErrInvalidWordbookID
	}

	return req.Msg.GetWordbookId(), req.Msg.GetTerms(), nil
}
