package entity

import (
	"testing"
)

func TestMasteryBreakdown_CalculateOverall(t *testing.T) {
	tests := []struct {
		name     string
		mastery  MasteryBreakdown
		expected int32
	}{
		{
			name: "all zeros",
			mastery: MasteryBreakdown{
				Listen:    0,
				Read:      0,
				Spell:     0,
				Pronounce: 0,
			},
			expected: 0,
		},
		{
			name: "all max values",
			mastery: MasteryBreakdown{
				Listen:    5,
				Read:      5,
				Spell:     5,
				Pronounce: 5,
			},
			expected: 500,
		},
		{
			name: "receptive only (read+listen)",
			mastery: MasteryBreakdown{
				Listen:    5,
				Read:      5,
				Spell:     0,
				Pronounce: 0,
			},
			// rec = (5+5)/2 = 5.0
			// prod = 0.3*0 + 0.7*0 = 0
			// overall = round((0.6*5.0 + 0.4*0) * 100) = round(300) = 300
			expected: 300,
		},
		{
			name: "productive only (spell+pronounce)",
			mastery: MasteryBreakdown{
				Listen:    0,
				Read:      0,
				Spell:     5,
				Pronounce: 5,
			},
			// rec = 0
			// prod = 0.3*5 + 0.7*5 = 1.5 + 3.5 = 5.0
			// overall = round((0.6*0 + 0.4*5.0) * 100) = round(200) = 200
			expected: 200,
		},
		{
			name: "speaking weighted higher than spelling",
			mastery: MasteryBreakdown{
				Listen:    0,
				Read:      0,
				Spell:     0,
				Pronounce: 5,
			},
			// rec = 0
			// prod = 0.3*0 + 0.7*5 = 3.5
			// overall = round((0.6*0 + 0.4*3.5) * 100) = round(140) = 140
			expected: 140,
		},
		{
			name: "spelling only (less weight)",
			mastery: MasteryBreakdown{
				Listen:    0,
				Read:      0,
				Spell:     5,
				Pronounce: 0,
			},
			// rec = 0
			// prod = 0.3*5 + 0.7*0 = 1.5
			// overall = round((0.6*0 + 0.4*1.5) * 100) = round(60) = 60
			expected: 60,
		},
		{
			name: "balanced mastery",
			mastery: MasteryBreakdown{
				Listen:    3,
				Read:      4,
				Spell:     2,
				Pronounce: 3,
			},
			// rec = (3+4)/2 = 3.5
			// prod = 0.3*2 + 0.7*3 = 0.6 + 2.1 = 2.7
			// overall = round((0.6*3.5 + 0.4*2.7) * 100) = round((2.1 + 1.08) * 100) = round(318) = 318
			expected: 318,
		},
		{
			name: "threshold testing - rec=4, prod=3",
			mastery: MasteryBreakdown{
				Listen:    4,
				Read:      4,
				Spell:     1,
				Pronounce: 4,
			},
			// rec = (4+4)/2 = 4.0
			// prod = 0.3*1 + 0.7*4 = 0.3 + 2.8 = 3.1
			// overall = round((0.6*4.0 + 0.4*3.1) * 100) = round((2.4 + 1.24) * 100) = round(364) = 364
			expected: 364,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.mastery.CalculateOverall()
			if result != tt.expected {
				t.Errorf("CalculateOverall() = %d, expected %d", result, tt.expected)
			}
		})
	}
}

func TestMasteryBreakdown_CalculateMasteryLevel(t *testing.T) {
	tests := []struct {
		name     string
		mastery  MasteryBreakdown
		expected MasteryLevel
	}{
		{
			name: "UNKNOWN - all zeros",
			mastery: MasteryBreakdown{
				Listen:    0,
				Read:      0,
				Spell:     0,
				Pronounce: 0,
			},
			expected: MasteryLevelUnknown,
		},
		{
			name: "LEARNING - some progress but rec < 4",
			mastery: MasteryBreakdown{
				Listen:    2,
				Read:      3,
				Spell:     1,
				Pronounce: 2,
			},
			// rec = (2+3)/2 = 2.5
			// prod = 0.3*1 + 0.7*2 = 1.7
			// rec < 4 → LEARNING
			expected: MasteryLevelLearning,
		},
		{
			name: "KNOWN - rec >= 4, prod < 3",
			mastery: MasteryBreakdown{
				Listen:    4,
				Read:      4,
				Spell:     0,
				Pronounce: 1,
			},
			// rec = (4+4)/2 = 4.0
			// prod = 0.3*0 + 0.7*1 = 0.7 < 3
			// rec >= 4, prod < 3 → KNOWN
			expected: MasteryLevelKnown,
		},
		{
			name: "KNOWN - rec >= 4, prod exactly at boundary (< 3)",
			mastery: MasteryBreakdown{
				Listen:    5,
				Read:      4,
				Spell:     1,
				Pronounce: 3,
			},
			// rec = (5+4)/2 = 4.5
			// prod = 0.3*1 + 0.7*3 = 0.3 + 2.1 = 2.4 < 3
			// rec >= 4, prod < 3 → KNOWN
			expected: MasteryLevelKnown,
		},
		{
			name: "MASTERED - rec >= 4, prod >= 3",
			mastery: MasteryBreakdown{
				Listen:    4,
				Read:      4,
				Spell:     2,
				Pronounce: 4,
			},
			// rec = (4+4)/2 = 4.0
			// prod = 0.3*2 + 0.7*4 = 0.6 + 2.8 = 3.4 >= 3
			// rec >= 4, prod >= 3 → MASTERED
			expected: MasteryLevelMastered,
		},
		{
			name: "MASTERED - all max",
			mastery: MasteryBreakdown{
				Listen:    5,
				Read:      5,
				Spell:     5,
				Pronounce: 5,
			},
			// rec = 5, prod = 5
			// rec >= 4, prod >= 3 → MASTERED
			expected: MasteryLevelMastered,
		},
		{
			name: "KNOWN - high receptive, low productive",
			mastery: MasteryBreakdown{
				Listen:    5,
				Read:      5,
				Spell:     0,
				Pronounce: 0,
			},
			// rec = 5, prod = 0
			// rec >= 4, prod < 3 → KNOWN
			expected: MasteryLevelKnown,
		},
		{
			name: "LEARNING - low receptive, high productive",
			mastery: MasteryBreakdown{
				Listen:    2,
				Read:      2,
				Spell:     5,
				Pronounce: 5,
			},
			// rec = 2, prod = 5
			// rec < 4 → LEARNING
			expected: MasteryLevelLearning,
		},
		{
			name: "MASTERED - exactly at threshold",
			mastery: MasteryBreakdown{
				Listen:    4,
				Read:      4,
				Spell:     0,
				Pronounce: 5,
			},
			// rec = (4+4)/2 = 4.0
			// prod = 0.3*0 + 0.7*5 = 3.5 >= 3
			// rec >= 4, prod >= 3 → MASTERED
			expected: MasteryLevelMastered,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.mastery.CalculateMasteryLevel()
			if result != tt.expected {
				t.Errorf("CalculateMasteryLevel() = %d (%s), expected %d (%s)",
					result, masteryLevelName(result),
					tt.expected, masteryLevelName(tt.expected))
			}
		})
	}
}

func TestMasteryBreakdown_Normalize(t *testing.T) {
	tests := []struct {
		name            string
		mastery         MasteryBreakdown
		expectedOverall int32
	}{
		{
			name: "normalize recalculates overall",
			mastery: MasteryBreakdown{
				Listen:    3,
				Read:      4,
				Spell:     2,
				Pronounce: 3,
				Overall:   999, // Wrong value, should be recalculated
			},
			// rec = 3.5, prod = 2.7, overall = 318
			expectedOverall: 318,
		},
		{
			name: "normalize with all zeros",
			mastery: MasteryBreakdown{
				Listen:    0,
				Read:      0,
				Spell:     0,
				Pronounce: 0,
				Overall:   100, // Wrong value
			},
			expectedOverall: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := tt.mastery
			m.Normalize()
			if m.Overall != tt.expectedOverall {
				t.Errorf("After Normalize(), Overall = %d, expected %d", m.Overall, tt.expectedOverall)
			}
		})
	}
}

func TestMasteryBreakdown_InitializeFromUserMasteryLevel(t *testing.T) {
	tests := []struct {
		name              string
		level             int32
		expectedListen    int32
		expectedRead      int32
		expectedSpell     int32
		expectedPronounce int32
		expectedLevel     MasteryLevel
		overallMin        int32 // Minimum expected overall value
		overallMax        int32 // Maximum expected overall value
	}{
		{
			name:              "level 0 - unknown",
			level:             0,
			expectedListen:    0,
			expectedRead:      0,
			expectedSpell:     0,
			expectedPronounce: 0,
			expectedLevel:     MasteryLevelUnknown,
			overallMin:        0,
			overallMax:        0,
		},
		{
			name:              "level 1 - seen before",
			level:             1,
			expectedListen:    1,
			expectedRead:      2,
			expectedSpell:     0,
			expectedPronounce: 0,
			expectedLevel:     MasteryLevelLearning,
			// rec = (1+2)/2 = 1.5, prod = 0
			// overall = round((0.6*1.5 + 0.4*0) * 100) = round(90) = 90
			overallMin: 90,
			overallMax: 90,
		},
		{
			name:              "level 2 - recognize in context",
			level:             2,
			expectedListen:    2,
			expectedRead:      3,
			expectedSpell:     1,
			expectedPronounce: 0,
			expectedLevel:     MasteryLevelLearning,
			// rec = (2+3)/2 = 2.5, prod = 0.3*1 + 0.7*0 = 0.3
			// overall = round((0.6*2.5 + 0.4*0.3) * 100) = round((1.5 + 0.12) * 100) = round(162) = 162
			overallMin: 162,
			overallMax: 162,
		},
		{
			name:              "level 3 - know well",
			level:             3,
			expectedListen:    3,
			expectedRead:      4,
			expectedSpell:     1,
			expectedPronounce: 2,
			expectedLevel:     MasteryLevelLearning,
			// rec = (3+4)/2 = 3.5, prod = 0.3*1 + 0.7*2 = 0.3 + 1.4 = 1.7
			// overall = round((0.6*3.5 + 0.4*1.7) * 100) = round((2.1 + 0.68) * 100) = round(278) = 278
			overallMin: 278,
			overallMax: 278,
		},
		{
			name:              "level 4 - can use passively",
			level:             4,
			expectedListen:    4,
			expectedRead:      4,
			expectedSpell:     2,
			expectedPronounce: 3,
			expectedLevel:     MasteryLevelKnown,
			// rec = (4+4)/2 = 4.0, prod = 0.3*2 + 0.7*3 = 0.6 + 2.1 = 2.7
			// overall = round((0.6*4.0 + 0.4*2.7) * 100) = round((2.4 + 1.08) * 100) = round(348) = 348
			overallMin: 348,
			overallMax: 348,
		},
		{
			name:              "level 5 - fully mastered",
			level:             5,
			expectedListen:    5,
			expectedRead:      5,
			expectedSpell:     4,
			expectedPronounce: 5,
			expectedLevel:     MasteryLevelMastered,
			// rec = (5+5)/2 = 5.0, prod = 0.3*4 + 0.7*5 = 1.2 + 3.5 = 4.7
			// overall = round((0.6*5.0 + 0.4*4.7) * 100) = round((3.0 + 1.88) * 100) = round(488) = 488
			overallMin: 488,
			overallMax: 488,
		},
		{
			name:              "invalid level -1",
			level:             -1,
			expectedListen:    0,
			expectedRead:      0,
			expectedSpell:     0,
			expectedPronounce: 0,
			expectedLevel:     MasteryLevelUnknown,
			overallMin:        0,
			overallMax:        0,
		},
		{
			name:              "invalid level 10",
			level:             10,
			expectedListen:    0,
			expectedRead:      0,
			expectedSpell:     0,
			expectedPronounce: 0,
			expectedLevel:     MasteryLevelUnknown,
			overallMin:        0,
			overallMax:        0,
		},
		{
			name:              "invalid level 6",
			level:             6,
			expectedListen:    0,
			expectedRead:      0,
			expectedSpell:     0,
			expectedPronounce: 0,
			expectedLevel:     MasteryLevelUnknown,
			overallMin:        0,
			overallMax:        0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var m MasteryBreakdown
			m.InitializeFromUserMasteryLevel(tt.level)

			// Verify dimensions
			if m.Listen != tt.expectedListen {
				t.Errorf("Listen = %d, expected %d", m.Listen, tt.expectedListen)
			}
			if m.Read != tt.expectedRead {
				t.Errorf("Read = %d, expected %d", m.Read, tt.expectedRead)
			}
			if m.Spell != tt.expectedSpell {
				t.Errorf("Spell = %d, expected %d", m.Spell, tt.expectedSpell)
			}
			if m.Pronounce != tt.expectedPronounce {
				t.Errorf("Pronounce = %d, expected %d", m.Pronounce, tt.expectedPronounce)
			}

			// Verify Overall is in expected range
			if m.Overall < tt.overallMin || m.Overall > tt.overallMax {
				t.Errorf("Overall = %d, expected between %d and %d", m.Overall, tt.overallMin, tt.overallMax)
			}

			// Verify MasteryLevel enum
			level := m.CalculateMasteryLevel()
			if level != tt.expectedLevel {
				t.Errorf("CalculateMasteryLevel() = %d (%s), expected %d (%s)",
					level, masteryLevelName(level),
					tt.expectedLevel, masteryLevelName(tt.expectedLevel))
			}
		})
	}
}

// Helper function to get mastery level name for better error messages
func masteryLevelName(level MasteryLevel) string {
	switch level {
	case MasteryLevelUnspecified:
		return "UNSPECIFIED"
	case MasteryLevelUnknown:
		return "UNKNOWN"
	case MasteryLevelLearning:
		return "LEARNING"
	case MasteryLevelKnown:
		return "KNOWN"
	case MasteryLevelMastered:
		return "MASTERED"
	default:
		return "INVALID"
	}
}
