package pipeline

import (
	"context"
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEnrichmentProcessor_NilProvider(t *testing.T) {
	p := NewEnrichmentProcessor(nil, testLogger())
	result, err := p.Process(context.Background(), &PipelineContext{})

	require.NoError(t, err)
	assert.Equal(t, ProcessStatusSkipped, result.Status)
}

func TestEnrichmentProcessor_NoIncompleteLexemes(t *testing.T) {
	p := NewEnrichmentProcessor(&mockLLM{}, testLogger())
	pctx := &PipelineContext{
		Term: "hello",
		Lexemes: []*entity.Lexeme{
			{
				ID:         1,
				ExternalID: "L100",
				SenseGloss: "a greeting",
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "greeting", Examples: []entity.SenseExample{{Text: "Hello!"}}},
					{Language: entity.LanguageChinese, Gloss: "问候", Examples: []entity.SenseExample{{Text: "你好"}}},
				},
			},
		},
	}

	result, err := p.Process(context.Background(), pctx)

	require.NoError(t, err)
	assert.Equal(t, ProcessStatusNoData, result.Status)
}

func TestEnrichmentProcessor_EnrichesLexemes(t *testing.T) {
	mock := &mockLLM{
		response: `{
			"lexemes": [
				{
					"lexeme_id": "L100",
					"sense_gloss": "a greeting used to say hi",
					"senses": [
						{
							"language": "en",
							"gloss": "a greeting",
							"examples": [{"text": "Hello there!", "translation": ""}]
						},
						{
							"language": "zh",
							"gloss": "问候",
							"examples": [{"text": "你好", "translation": "Hello"}]
						}
					]
				}
			]
		}`,
	}

	p := NewEnrichmentProcessor(mock, testLogger())
	pctx := &PipelineContext{
		Term: "hello",
		Lexemes: []*entity.Lexeme{
			{
				ID:         1,
				ExternalID: "L100",
				SenseGloss: "", // empty - needs enrichment
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "a greeting"},
				},
			},
		},
	}

	result, err := p.Process(context.Background(), pctx)

	require.NoError(t, err)
	assert.Equal(t, ProcessStatusExecuted, result.Status)
	assert.Len(t, result.Lexemes, 1)
	assert.Equal(t, "a greeting used to say hi", result.Lexemes[0].SenseGloss)
	assert.Len(t, result.Evidence, 1)
}

func TestNeedsEnrichment(t *testing.T) {
	tests := []struct {
		name   string
		lexeme *entity.Lexeme
		want   bool
	}{
		{
			name:   "empty sense gloss",
			lexeme: &entity.Lexeme{SenseGloss: ""},
			want:   true,
		},
		{
			name: "missing Chinese sense",
			lexeme: &entity.Lexeme{
				SenseGloss: "test",
				Senses:     []entity.LexemeSense{{Language: entity.LanguageEnglish, Gloss: "test", Examples: []entity.SenseExample{{Text: "x"}}}},
			},
			want: true,
		},
		{
			name: "missing examples",
			lexeme: &entity.Lexeme{
				SenseGloss: "test",
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "test"},
					{Language: entity.LanguageChinese, Gloss: "测试"},
				},
			},
			want: true,
		},
		{
			name: "complete lexeme",
			lexeme: &entity.Lexeme{
				SenseGloss: "a test",
				Senses: []entity.LexemeSense{
					{Language: entity.LanguageEnglish, Gloss: "test", Examples: []entity.SenseExample{{Text: "a test"}}},
					{Language: entity.LanguageChinese, Gloss: "测试", Examples: []entity.SenseExample{{Text: "测试"}}},
				},
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, needsEnrichment(tt.lexeme))
		})
	}
}
