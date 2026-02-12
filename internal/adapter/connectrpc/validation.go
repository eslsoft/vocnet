package connectrpc

import (
	"connectrpc.com/connect"

	commonv1 "github.com/eslsoft/vocnet/pkg/api/common/v1"
)

func extractID(req *connect.Request[commonv1.IDRequest], invalidErr error) (int64, error) {
	if req == nil || req.Msg == nil || req.Msg.GetId() == 0 {
		return 0, invalidErr
	}
	return req.Msg.GetId(), nil
}
