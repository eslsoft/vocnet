package pipeline

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRelationTargetLookupTerms(t *testing.T) {
	got := relationTargetLookupTerms("synset:00001740 (living_thing)")
	require.Equal(t, []string{
		"synset:00001740 (living_thing)",
		"synset:00001740 (living thing)",
		"living_thing",
	}, got)
}
