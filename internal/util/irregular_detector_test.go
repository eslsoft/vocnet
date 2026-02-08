package util

import (
	"testing"

	"github.com/eslsoft/vocnet/internal/entity"
)

func TestIsIrregularForm(t *testing.T) {
	tests := []struct {
		name          string
		lemma         string
		form          string
		formType      entity.LexemeFormType
		wantIrregular bool
	}{
		// Regular plural forms
		{name: "regular plural +s", lemma: "cat", form: "cats", formType: entity.LexemeFormTypePlural, wantIrregular: false},
		{name: "regular plural +es (x)", lemma: "box", form: "boxes", formType: entity.LexemeFormTypePlural, wantIrregular: false},
		{name: "regular plural +es (ch)", lemma: "church", form: "churches", formType: entity.LexemeFormTypePlural, wantIrregular: false},
		{name: "regular plural consonant+y→ies", lemma: "baby", form: "babies", formType: entity.LexemeFormTypePlural, wantIrregular: false},
		{name: "regular plural vowel+y→s", lemma: "boy", form: "boys", formType: entity.LexemeFormTypePlural, wantIrregular: false},
		{name: "regular plural f→ves", lemma: "leaf", form: "leaves", formType: entity.LexemeFormTypePlural, wantIrregular: false},
		{name: "regular plural fe→ves", lemma: "knife", form: "knives", formType: entity.LexemeFormTypePlural, wantIrregular: false},

		// Irregular plural forms
		{name: "irregular plural child→children", lemma: "child", form: "children", formType: entity.LexemeFormTypePlural, wantIrregular: true},
		{name: "irregular plural man→men", lemma: "man", form: "men", formType: entity.LexemeFormTypePlural, wantIrregular: true},
		{name: "irregular plural mouse→mice", lemma: "mouse", form: "mice", formType: entity.LexemeFormTypePlural, wantIrregular: true},
		{name: "irregular plural foot→feet", lemma: "foot", form: "feet", formType: entity.LexemeFormTypePlural, wantIrregular: true},

		// Regular past tense forms
		{name: "regular past +ed", lemma: "walk", form: "walked", formType: entity.LexemeFormTypePast, wantIrregular: false},
		{name: "regular past e+d", lemma: "live", form: "lived", formType: entity.LexemeFormTypePast, wantIrregular: false},
		{name: "regular past consonant+y→ied", lemma: "study", form: "studied", formType: entity.LexemeFormTypePast, wantIrregular: false},
		{name: "regular past CVC double+ed", lemma: "stop", form: "stopped", formType: entity.LexemeFormTypePast, wantIrregular: false},
		{name: "regular past CVC double+ed (plan)", lemma: "plan", form: "planned", formType: entity.LexemeFormTypePast, wantIrregular: false},

		// Irregular past tense forms
		{name: "irregular past run→ran", lemma: "run", form: "ran", formType: entity.LexemeFormTypePast, wantIrregular: true},
		{name: "irregular past go→went", lemma: "go", form: "went", formType: entity.LexemeFormTypePast, wantIrregular: true},
		{name: "irregular past eat→ate", lemma: "eat", form: "ate", formType: entity.LexemeFormTypePast, wantIrregular: true},
		{name: "irregular past see→saw", lemma: "see", form: "saw", formType: entity.LexemeFormTypePast, wantIrregular: true},
		{name: "irregular past same form cut→cut", lemma: "cut", form: "cut", formType: entity.LexemeFormTypePast, wantIrregular: true},

		// Regular past participle forms
		{name: "regular past participle +ed", lemma: "walk", form: "walked", formType: entity.LexemeFormTypePastParticiple, wantIrregular: false},
		{name: "regular past participle e+d", lemma: "bake", form: "baked", formType: entity.LexemeFormTypePastParticiple, wantIrregular: false},

		// Irregular past participle forms
		{name: "irregular past participle eat→eaten", lemma: "eat", form: "eaten", formType: entity.LexemeFormTypePastParticiple, wantIrregular: true},
		{name: "irregular past participle see→seen", lemma: "see", form: "seen", formType: entity.LexemeFormTypePastParticiple, wantIrregular: true},
		{name: "irregular past participle go→gone", lemma: "go", form: "gone", formType: entity.LexemeFormTypePastParticiple, wantIrregular: true},

		// Regular present participle forms
		{name: "regular present participle +ing", lemma: "walk", form: "walking", formType: entity.LexemeFormTypePresentParticiple, wantIrregular: false},
		{name: "regular present participle e→ing", lemma: "make", form: "making", formType: entity.LexemeFormTypePresentParticiple, wantIrregular: false},
		{name: "regular present participle double+ing", lemma: "run", form: "running", formType: entity.LexemeFormTypePresentParticiple, wantIrregular: false},
		{name: "regular present participle ie→ying", lemma: "die", form: "dying", formType: entity.LexemeFormTypePresentParticiple, wantIrregular: false},

		// Regular third person singular forms
		{name: "regular 3rd person +s", lemma: "walk", form: "walks", formType: entity.LexemeFormTypeThirdPersonSingular, wantIrregular: false},
		{name: "regular 3rd person +es", lemma: "go", form: "goes", formType: entity.LexemeFormTypeThirdPersonSingular, wantIrregular: false},
		{name: "regular 3rd person consonant+y→ies", lemma: "study", form: "studies", formType: entity.LexemeFormTypeThirdPersonSingular, wantIrregular: false},

		// Irregular third person singular forms
		{name: "irregular 3rd person be→is", lemma: "be", form: "is", formType: entity.LexemeFormTypeThirdPersonSingular, wantIrregular: true},
		{name: "irregular 3rd person have→has", lemma: "have", form: "has", formType: entity.LexemeFormTypeThirdPersonSingular, wantIrregular: true},

		// Regular comparative forms
		{name: "regular comparative +er", lemma: "tall", form: "taller", formType: entity.LexemeFormTypeComparative, wantIrregular: false},
		{name: "regular comparative e+r", lemma: "nice", form: "nicer", formType: entity.LexemeFormTypeComparative, wantIrregular: false},
		{name: "regular comparative consonant+y→ier", lemma: "happy", form: "happier", formType: entity.LexemeFormTypeComparative, wantIrregular: false},

		// Irregular comparative forms
		{name: "irregular comparative good→better", lemma: "good", form: "better", formType: entity.LexemeFormTypeComparative, wantIrregular: true},
		{name: "irregular comparative bad→worse", lemma: "bad", form: "worse", formType: entity.LexemeFormTypeComparative, wantIrregular: true},

		// Regular superlative forms
		{name: "regular superlative +est", lemma: "tall", form: "tallest", formType: entity.LexemeFormTypeSuperlative, wantIrregular: false},
		{name: "regular superlative e+st", lemma: "nice", form: "nicest", formType: entity.LexemeFormTypeSuperlative, wantIrregular: false},

		// Irregular superlative forms
		{name: "irregular superlative good→best", lemma: "good", form: "best", formType: entity.LexemeFormTypeSuperlative, wantIrregular: true},
		{name: "irregular superlative bad→worst", lemma: "bad", form: "worst", formType: entity.LexemeFormTypeSuperlative, wantIrregular: true},

		// Empty strings and lemma forms
		{name: "empty lemma", lemma: "", form: "test", formType: entity.LexemeFormTypePlural, wantIrregular: false},
		{name: "empty form", lemma: "test", form: "", formType: entity.LexemeFormTypePlural, wantIrregular: false},
		{name: "lemma form (same as lemma)", lemma: "test", form: "test", formType: entity.LexemeFormTypeLemma, wantIrregular: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsIrregularForm(tt.lemma, tt.form, tt.formType)
			if got != tt.wantIrregular {
				t.Errorf("IsIrregularForm(%q, %q, %v) = %v, want %v",
					tt.lemma, tt.form, tt.formType, got, tt.wantIrregular)
			}
		})
	}
}
