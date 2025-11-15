package main

import (
	"testing"

	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

func TestIsIrregularForm(t *testing.T) {
	tests := []struct {
		name       string
		lemma      string
		form       string
		formType   dictv1.FormType
		wantIrregular bool
	}{
		// Regular plural forms
		{name: "regular plural +s", lemma: "cat", form: "cats", formType: dictv1.FormType_FORM_TYPE_PLURAL, wantIrregular: false},
		{name: "regular plural +es (x)", lemma: "box", form: "boxes", formType: dictv1.FormType_FORM_TYPE_PLURAL, wantIrregular: false},
		{name: "regular plural +es (ch)", lemma: "church", form: "churches", formType: dictv1.FormType_FORM_TYPE_PLURAL, wantIrregular: false},
		{name: "regular plural consonant+y→ies", lemma: "baby", form: "babies", formType: dictv1.FormType_FORM_TYPE_PLURAL, wantIrregular: false},
		{name: "regular plural vowel+y→s", lemma: "boy", form: "boys", formType: dictv1.FormType_FORM_TYPE_PLURAL, wantIrregular: false},
		{name: "regular plural f→ves", lemma: "leaf", form: "leaves", formType: dictv1.FormType_FORM_TYPE_PLURAL, wantIrregular: false},
		{name: "regular plural fe→ves", lemma: "knife", form: "knives", formType: dictv1.FormType_FORM_TYPE_PLURAL, wantIrregular: false},

		// Irregular plural forms
		{name: "irregular plural child→children", lemma: "child", form: "children", formType: dictv1.FormType_FORM_TYPE_PLURAL, wantIrregular: true},
		{name: "irregular plural man→men", lemma: "man", form: "men", formType: dictv1.FormType_FORM_TYPE_PLURAL, wantIrregular: true},
		{name: "irregular plural mouse→mice", lemma: "mouse", form: "mice", formType: dictv1.FormType_FORM_TYPE_PLURAL, wantIrregular: true},
		{name: "irregular plural foot→feet", lemma: "foot", form: "feet", formType: dictv1.FormType_FORM_TYPE_PLURAL, wantIrregular: true},

		// Regular past tense forms
		{name: "regular past +ed", lemma: "walk", form: "walked", formType: dictv1.FormType_FORM_TYPE_PAST, wantIrregular: false},
		{name: "regular past e+d", lemma: "live", form: "lived", formType: dictv1.FormType_FORM_TYPE_PAST, wantIrregular: false},
		{name: "regular past consonant+y→ied", lemma: "study", form: "studied", formType: dictv1.FormType_FORM_TYPE_PAST, wantIrregular: false},
		{name: "regular past CVC double+ed", lemma: "stop", form: "stopped", formType: dictv1.FormType_FORM_TYPE_PAST, wantIrregular: false},
		{name: "regular past CVC double+ed (plan)", lemma: "plan", form: "planned", formType: dictv1.FormType_FORM_TYPE_PAST, wantIrregular: false},

		// Irregular past tense forms
		{name: "irregular past run→ran", lemma: "run", form: "ran", formType: dictv1.FormType_FORM_TYPE_PAST, wantIrregular: true},
		{name: "irregular past go→went", lemma: "go", form: "went", formType: dictv1.FormType_FORM_TYPE_PAST, wantIrregular: true},
		{name: "irregular past eat→ate", lemma: "eat", form: "ate", formType: dictv1.FormType_FORM_TYPE_PAST, wantIrregular: true},
		{name: "irregular past see→saw", lemma: "see", form: "saw", formType: dictv1.FormType_FORM_TYPE_PAST, wantIrregular: true},
		{name: "irregular past same form cut→cut", lemma: "cut", form: "cut", formType: dictv1.FormType_FORM_TYPE_PAST, wantIrregular: true},

		// Regular past participle forms
		{name: "regular past participle +ed", lemma: "walk", form: "walked", formType: dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE, wantIrregular: false},
		{name: "regular past participle e+d", lemma: "bake", form: "baked", formType: dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE, wantIrregular: false},

		// Irregular past participle forms
		{name: "irregular past participle run→run", lemma: "run", form: "run", formType: dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE, wantIrregular: true},
		{name: "irregular past participle go→gone", lemma: "go", form: "gone", formType: dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE, wantIrregular: true},
		{name: "irregular past participle eat→eaten", lemma: "eat", form: "eaten", formType: dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE, wantIrregular: true},
		{name: "irregular past participle see→seen", lemma: "see", form: "seen", formType: dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE, wantIrregular: true},

		// Regular present participle forms
		{name: "regular present participle +ing", lemma: "walk", form: "walking", formType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE, wantIrregular: false},
		{name: "regular present participle e→ing", lemma: "make", form: "making", formType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE, wantIrregular: false},
		{name: "regular present participle CVC double+ing", lemma: "run", form: "running", formType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE, wantIrregular: false},
		{name: "regular present participle ie→ying", lemma: "die", form: "dying", formType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE, wantIrregular: false},
		{name: "regular present participle ee+ing", lemma: "see", form: "seeing", formType: dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE, wantIrregular: false},

		// Note: Most present participles are regular in English
		// "being" follows the standard +ing rule for "be", so it's considered regular

		// Regular third person singular forms
		{name: "regular 3rd person +s", lemma: "walk", form: "walks", formType: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR, wantIrregular: false},
		{name: "regular 3rd person +es (ch)", lemma: "watch", form: "watches", formType: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR, wantIrregular: false},
		{name: "regular 3rd person +es (o)", lemma: "go", form: "goes", formType: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR, wantIrregular: false},
		{name: "regular 3rd person consonant+y→ies", lemma: "study", form: "studies", formType: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR, wantIrregular: false},
		{name: "regular 3rd person vowel+y→s", lemma: "play", form: "plays", formType: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR, wantIrregular: false},

		// Irregular third person singular forms
		{name: "irregular 3rd person be→is", lemma: "be", form: "is", formType: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR, wantIrregular: true},
		{name: "irregular 3rd person have→has", lemma: "have", form: "has", formType: dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR, wantIrregular: true},

		// Regular comparative forms
		{name: "regular comparative +er", lemma: "fast", form: "faster", formType: dictv1.FormType_FORM_TYPE_COMPARATIVE, wantIrregular: false},
		{name: "regular comparative e+r", lemma: "large", form: "larger", formType: dictv1.FormType_FORM_TYPE_COMPARATIVE, wantIrregular: false},
		{name: "regular comparative consonant+y→ier", lemma: "happy", form: "happier", formType: dictv1.FormType_FORM_TYPE_COMPARATIVE, wantIrregular: false},
		{name: "regular comparative CVC double+er", lemma: "big", form: "bigger", formType: dictv1.FormType_FORM_TYPE_COMPARATIVE, wantIrregular: false},

		// Irregular comparative forms
		{name: "irregular comparative good→better", lemma: "good", form: "better", formType: dictv1.FormType_FORM_TYPE_COMPARATIVE, wantIrregular: true},
		{name: "irregular comparative bad→worse", lemma: "bad", form: "worse", formType: dictv1.FormType_FORM_TYPE_COMPARATIVE, wantIrregular: true},
		{name: "irregular comparative far→farther", lemma: "far", form: "farther", formType: dictv1.FormType_FORM_TYPE_COMPARATIVE, wantIrregular: true},

		// Regular superlative forms
		{name: "regular superlative +est", lemma: "fast", form: "fastest", formType: dictv1.FormType_FORM_TYPE_SUPERLATIVE, wantIrregular: false},
		{name: "regular superlative e+st", lemma: "large", form: "largest", formType: dictv1.FormType_FORM_TYPE_SUPERLATIVE, wantIrregular: false},
		{name: "regular superlative consonant+y→iest", lemma: "happy", form: "happiest", formType: dictv1.FormType_FORM_TYPE_SUPERLATIVE, wantIrregular: false},
		{name: "regular superlative CVC double+est", lemma: "big", form: "biggest", formType: dictv1.FormType_FORM_TYPE_SUPERLATIVE, wantIrregular: false},

		// Irregular superlative forms
		{name: "irregular superlative good→best", lemma: "good", form: "best", formType: dictv1.FormType_FORM_TYPE_SUPERLATIVE, wantIrregular: true},
		{name: "irregular superlative bad→worst", lemma: "bad", form: "worst", formType: dictv1.FormType_FORM_TYPE_SUPERLATIVE, wantIrregular: true},
		{name: "irregular superlative far→farthest", lemma: "far", form: "farthest", formType: dictv1.FormType_FORM_TYPE_SUPERLATIVE, wantIrregular: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isIrregularForm(tt.lemma, tt.form, tt.formType)
			if got != tt.wantIrregular {
				t.Errorf("isIrregularForm(%q, %q, %v) = %v, want %v",
					tt.lemma, tt.form, tt.formType, got, tt.wantIrregular)
			}
		})
	}
}

func TestIsRegularPlural(t *testing.T) {
	tests := []struct {
		name     string
		singular string
		plural   string
		want     bool
	}{
		{"standard +s", "cat", "cats", true},
		{"x ending +es", "box", "boxes", true},
		{"ch ending +es", "church", "churches", true},
		{"sh ending +es", "dish", "dishes", true},
		{"consonant+y→ies", "baby", "babies", true},
		{"vowel+y→s", "boy", "boys", true},
		{"f→ves", "leaf", "leaves", true},
		{"fe→ves", "knife", "knives", true},
		{"o→es", "potato", "potatoes", true},
		{"o→s", "photo", "photos", true},

		{"irregular child→children", "child", "children", false},
		{"irregular man→men", "man", "men", false},
		{"irregular mouse→mice", "mouse", "mice", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isRegularPlural(tt.singular, tt.plural)
			if got != tt.want {
				t.Errorf("isRegularPlural(%q, %q) = %v, want %v",
					tt.singular, tt.plural, got, tt.want)
			}
		})
	}
}

func TestIsRegularPast(t *testing.T) {
	tests := []struct {
		name string
		base string
		past string
		want bool
	}{
		{"standard +ed", "walk", "walked", true},
		{"silent e +d", "live", "lived", true},
		{"consonant+y→ied", "study", "studied", true},
		{"CVC double+ed", "stop", "stopped", true},
		{"CVC double+ed (plan)", "plan", "planned", true},

		{"irregular run→ran", "run", "ran", false},
		{"irregular go→went", "go", "went", false},
		{"irregular eat→ate", "eat", "ate", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isRegularPast(tt.base, tt.past)
			if got != tt.want {
				t.Errorf("isRegularPast(%q, %q) = %v, want %v",
					tt.base, tt.past, got, tt.want)
			}
		})
	}
}

func TestIsRegularPresentParticiple(t *testing.T) {
	tests := []struct {
		name       string
		base       string
		participle string
		want       bool
	}{
		{"standard +ing", "walk", "walking", true},
		{"drop e +ing", "make", "making", true},
		{"CVC double+ing", "run", "running", true},
		{"ie→ying", "die", "dying", true},
		{"ee keep e", "see", "seeing", true},
		// Note: Most present participles in English are regular
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isRegularPresentParticiple(tt.base, tt.participle)
			if got != tt.want {
				t.Errorf("isRegularPresentParticiple(%q, %q) = %v, want %v",
					tt.base, tt.participle, got, tt.want)
			}
		})
	}
}

func TestIsRegularThirdPerson(t *testing.T) {
	tests := []struct {
		name        string
		base        string
		thirdPerson string
		want        bool
	}{
		{"standard +s", "walk", "walks", true},
		{"ch ending +es", "watch", "watches", true},
		{"o ending +es", "go", "goes", true},
		{"consonant+y→ies", "study", "studies", true},
		{"vowel+y→s", "play", "plays", true},

		{"irregular be→is", "be", "is", false},
		{"irregular have→has", "have", "has", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isRegularThirdPerson(tt.base, tt.thirdPerson)
			if got != tt.want {
				t.Errorf("isRegularThirdPerson(%q, %q) = %v, want %v",
					tt.base, tt.thirdPerson, got, tt.want)
			}
		})
	}
}

func TestIsRegularComparative(t *testing.T) {
	tests := []struct {
		name        string
		base        string
		comparative string
		want        bool
	}{
		{"standard +er", "fast", "faster", true},
		{"silent e +r", "large", "larger", true},
		{"consonant+y→ier", "happy", "happier", true},
		{"CVC double+er", "big", "bigger", true},

		{"irregular good→better", "good", "better", false},
		{"irregular bad→worse", "bad", "worse", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isRegularComparative(tt.base, tt.comparative)
			if got != tt.want {
				t.Errorf("isRegularComparative(%q, %q) = %v, want %v",
					tt.base, tt.comparative, got, tt.want)
			}
		})
	}
}

func TestIsRegularSuperlative(t *testing.T) {
	tests := []struct {
		name        string
		base        string
		superlative string
		want        bool
	}{
		{"standard +est", "fast", "fastest", true},
		{"silent e +st", "large", "largest", true},
		{"consonant+y→iest", "happy", "happiest", true},
		{"CVC double+est", "big", "biggest", true},

		{"irregular good→best", "good", "best", false},
		{"irregular bad→worst", "bad", "worst", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isRegularSuperlative(tt.base, tt.superlative)
			if got != tt.want {
				t.Errorf("isRegularSuperlative(%q, %q) = %v, want %v",
					tt.base, tt.superlative, got, tt.want)
			}
		})
	}
}
