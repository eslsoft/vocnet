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
		formType      entity.FormType
		wantIrregular bool
	}{
		// ===== PLURAL =====

		// Regular plural: +s
		{name: "regular plural +s (cat→cats)", lemma: "cat", form: "cats", formType: entity.FormTypePlural, wantIrregular: false},
		{name: "regular plural +s (dog→dogs)", lemma: "dog", form: "dogs", formType: entity.FormTypePlural, wantIrregular: false},
		{name: "regular plural +s (book→books)", lemma: "book", form: "books", formType: entity.FormTypePlural, wantIrregular: false},
		// Regular plural: +es (sibilant endings)
		{name: "regular plural +es (box→boxes)", lemma: "box", form: "boxes", formType: entity.FormTypePlural, wantIrregular: false},
		{name: "regular plural +es (church→churches)", lemma: "church", form: "churches", formType: entity.FormTypePlural, wantIrregular: false},
		{name: "regular plural +es (bus→buses)", lemma: "bus", form: "buses", formType: entity.FormTypePlural, wantIrregular: false},
		{name: "regular plural +es (dish→dishes)", lemma: "dish", form: "dishes", formType: entity.FormTypePlural, wantIrregular: false},
		{name: "regular plural +es (buzz→buzzes)", lemma: "buzz", form: "buzzes", formType: entity.FormTypePlural, wantIrregular: false},
		// Regular plural: consonant+y → ies
		{name: "regular plural consonant+y→ies (baby→babies)", lemma: "baby", form: "babies", formType: entity.FormTypePlural, wantIrregular: false},
		{name: "regular plural consonant+y→ies (city→cities)", lemma: "city", form: "cities", formType: entity.FormTypePlural, wantIrregular: false},
		// Regular plural: vowel+y → +s
		{name: "regular plural vowel+y→s (boy→boys)", lemma: "boy", form: "boys", formType: entity.FormTypePlural, wantIrregular: false},
		{name: "regular plural vowel+y→s (key→keys)", lemma: "key", form: "keys", formType: entity.FormTypePlural, wantIrregular: false},
		// Regular plural: -o → +s or +es (both accepted as regular)
		{name: "regular plural -o+es (potato→potatoes)", lemma: "potato", form: "potatoes", formType: entity.FormTypePlural, wantIrregular: false},
		{name: "regular plural -o+s (photo→photos)", lemma: "photo", form: "photos", formType: entity.FormTypePlural, wantIrregular: false},

		// Irregular plural: -f/-fe → -ves (NOT all -f words do this, so it's irregular)
		{name: "irregular plural f→ves (leaf→leaves)", lemma: "leaf", form: "leaves", formType: entity.FormTypePlural, wantIrregular: true},
		{name: "irregular plural fe→ves (knife→knives)", lemma: "knife", form: "knives", formType: entity.FormTypePlural, wantIrregular: true},
		{name: "irregular plural fe→ves (wife→wives)", lemma: "wife", form: "wives", formType: entity.FormTypePlural, wantIrregular: true},
		{name: "irregular plural f→ves (wolf→wolves)", lemma: "wolf", form: "wolves", formType: entity.FormTypePlural, wantIrregular: true},
		// Regular plural: -f words that just take +s
		{name: "regular plural f+s (roof→roofs)", lemma: "roof", form: "roofs", formType: entity.FormTypePlural, wantIrregular: false},
		{name: "regular plural f+s (chief→chiefs)", lemma: "chief", form: "chiefs", formType: entity.FormTypePlural, wantIrregular: false},
		{name: "regular plural f+s (cliff→cliffs)", lemma: "cliff", form: "cliffs", formType: entity.FormTypePlural, wantIrregular: false},

		// Irregular plural: zero plural (same form)
		{name: "irregular plural zero (sheep→sheep)", lemma: "sheep", form: "sheep", formType: entity.FormTypePlural, wantIrregular: true},
		{name: "irregular plural zero (fish→fish)", lemma: "fish", form: "fish", formType: entity.FormTypePlural, wantIrregular: true},
		{name: "irregular plural zero (deer→deer)", lemma: "deer", form: "deer", formType: entity.FormTypePlural, wantIrregular: true},

		// Irregular plural: vowel change / suppletive
		{name: "irregular plural (child→children)", lemma: "child", form: "children", formType: entity.FormTypePlural, wantIrregular: true},
		{name: "irregular plural (man→men)", lemma: "man", form: "men", formType: entity.FormTypePlural, wantIrregular: true},
		{name: "irregular plural (woman→women)", lemma: "woman", form: "women", formType: entity.FormTypePlural, wantIrregular: true},
		{name: "irregular plural (mouse→mice)", lemma: "mouse", form: "mice", formType: entity.FormTypePlural, wantIrregular: true},
		{name: "irregular plural (foot→feet)", lemma: "foot", form: "feet", formType: entity.FormTypePlural, wantIrregular: true},
		{name: "irregular plural (tooth→teeth)", lemma: "tooth", form: "teeth", formType: entity.FormTypePlural, wantIrregular: true},
		{name: "irregular plural (goose→geese)", lemma: "goose", form: "geese", formType: entity.FormTypePlural, wantIrregular: true},
		{name: "irregular plural (person→people)", lemma: "person", form: "people", formType: entity.FormTypePlural, wantIrregular: true},
		{name: "irregular plural (ox→oxen)", lemma: "ox", form: "oxen", formType: entity.FormTypePlural, wantIrregular: true},

		// ===== PAST TENSE =====

		// Regular past: +ed
		{name: "regular past +ed (walk→walked)", lemma: "walk", form: "walked", formType: entity.FormTypePast, wantIrregular: false},
		{name: "regular past +ed (play→played)", lemma: "play", form: "played", formType: entity.FormTypePast, wantIrregular: false},
		// Regular past: silent-e +d
		{name: "regular past e+d (live→lived)", lemma: "live", form: "lived", formType: entity.FormTypePast, wantIrregular: false},
		{name: "regular past e+d (hope→hoped)", lemma: "hope", form: "hoped", formType: entity.FormTypePast, wantIrregular: false},
		// Regular past: consonant+y → ied
		{name: "regular past consonant+y→ied (study→studied)", lemma: "study", form: "studied", formType: entity.FormTypePast, wantIrregular: false},
		{name: "regular past consonant+y→ied (carry→carried)", lemma: "carry", form: "carried", formType: entity.FormTypePast, wantIrregular: false},
		// Regular past: CVC doubling
		{name: "regular past CVC double (stop→stopped)", lemma: "stop", form: "stopped", formType: entity.FormTypePast, wantIrregular: false},
		{name: "regular past CVC double (plan→planned)", lemma: "plan", form: "planned", formType: entity.FormTypePast, wantIrregular: false},
		{name: "regular past CVC double (drop→dropped)", lemma: "drop", form: "dropped", formType: entity.FormTypePast, wantIrregular: false},
		// Regular past: no doubling for w/x/y endings
		{name: "regular past no double w (show→showed)", lemma: "show", form: "showed", formType: entity.FormTypePast, wantIrregular: false},
		{name: "regular past no double x (fix→fixed)", lemma: "fix", form: "fixed", formType: entity.FormTypePast, wantIrregular: false},

		// Irregular past: vowel change
		{name: "irregular past (run→ran)", lemma: "run", form: "ran", formType: entity.FormTypePast, wantIrregular: true},
		{name: "irregular past (swim→swam)", lemma: "swim", form: "swam", formType: entity.FormTypePast, wantIrregular: true},
		{name: "irregular past (sing→sang)", lemma: "sing", form: "sang", formType: entity.FormTypePast, wantIrregular: true},
		{name: "irregular past (drink→drank)", lemma: "drink", form: "drank", formType: entity.FormTypePast, wantIrregular: true},
		// Irregular past: suppletive
		{name: "irregular past (go→went)", lemma: "go", form: "went", formType: entity.FormTypePast, wantIrregular: true},
		{name: "irregular past (eat→ate)", lemma: "eat", form: "ate", formType: entity.FormTypePast, wantIrregular: true},
		{name: "irregular past (see→saw)", lemma: "see", form: "saw", formType: entity.FormTypePast, wantIrregular: true},
		{name: "irregular past (take→took)", lemma: "take", form: "took", formType: entity.FormTypePast, wantIrregular: true},
		{name: "irregular past (give→gave)", lemma: "give", form: "gave", formType: entity.FormTypePast, wantIrregular: true},
		// Irregular past: zero change
		{name: "irregular past zero (cut→cut)", lemma: "cut", form: "cut", formType: entity.FormTypePast, wantIrregular: true},
		{name: "irregular past zero (put→put)", lemma: "put", form: "put", formType: entity.FormTypePast, wantIrregular: true},
		{name: "irregular past zero (set→set)", lemma: "set", form: "set", formType: entity.FormTypePast, wantIrregular: true},
		// Irregular past: -t ending (not -ed)
		{name: "irregular past (sleep→slept)", lemma: "sleep", form: "slept", formType: entity.FormTypePast, wantIrregular: true},
		{name: "irregular past (keep→kept)", lemma: "keep", form: "kept", formType: entity.FormTypePast, wantIrregular: true},
		{name: "irregular past (feel→felt)", lemma: "feel", form: "felt", formType: entity.FormTypePast, wantIrregular: true},
		{name: "irregular past (build→built)", lemma: "build", form: "built", formType: entity.FormTypePast, wantIrregular: true},

		// ===== PAST PARTICIPLE =====

		// Regular past participle: same rules as past
		{name: "regular pp +ed (walk→walked)", lemma: "walk", form: "walked", formType: entity.FormTypePastParticiple, wantIrregular: false},
		{name: "regular pp e+d (bake→baked)", lemma: "bake", form: "baked", formType: entity.FormTypePastParticiple, wantIrregular: false},
		// Irregular past participle: -en suffix
		{name: "irregular pp (eat→eaten)", lemma: "eat", form: "eaten", formType: entity.FormTypePastParticiple, wantIrregular: true},
		{name: "irregular pp (see→seen)", lemma: "see", form: "seen", formType: entity.FormTypePastParticiple, wantIrregular: true},
		{name: "irregular pp (take→taken)", lemma: "take", form: "taken", formType: entity.FormTypePastParticiple, wantIrregular: true},
		{name: "irregular pp (give→given)", lemma: "give", form: "given", formType: entity.FormTypePastParticiple, wantIrregular: true},
		{name: "irregular pp (write→written)", lemma: "write", form: "written", formType: entity.FormTypePastParticiple, wantIrregular: true},
		{name: "irregular pp (speak→spoken)", lemma: "speak", form: "spoken", formType: entity.FormTypePastParticiple, wantIrregular: true},
		// Irregular past participle: suppletive
		{name: "irregular pp (go→gone)", lemma: "go", form: "gone", formType: entity.FormTypePastParticiple, wantIrregular: true},
		// Irregular past participle: different from past tense
		{name: "irregular pp (swim→swum)", lemma: "swim", form: "swum", formType: entity.FormTypePastParticiple, wantIrregular: true},
		{name: "irregular pp (sing→sung)", lemma: "sing", form: "sung", formType: entity.FormTypePastParticiple, wantIrregular: true},
		{name: "irregular pp (drink→drunk)", lemma: "drink", form: "drunk", formType: entity.FormTypePastParticiple, wantIrregular: true},

		// ===== PRESENT PARTICIPLE =====

		// Regular: +ing
		{name: "regular pres part +ing (walk→walking)", lemma: "walk", form: "walking", formType: entity.FormTypePresentParticiple, wantIrregular: false},
		{name: "regular pres part +ing (talk→talking)", lemma: "talk", form: "talking", formType: entity.FormTypePresentParticiple, wantIrregular: false},
		// Regular: drop silent-e + ing
		{name: "regular pres part e→ing (make→making)", lemma: "make", form: "making", formType: entity.FormTypePresentParticiple, wantIrregular: false},
		{name: "regular pres part e→ing (hope→hoping)", lemma: "hope", form: "hoping", formType: entity.FormTypePresentParticiple, wantIrregular: false},
		{name: "regular pres part e→ing (change→changing)", lemma: "change", form: "changing", formType: entity.FormTypePresentParticiple, wantIrregular: false},
		// Regular: keep -ee/-oe/-ye + ing
		{name: "regular pres part ee+ing (see→seeing)", lemma: "see", form: "seeing", formType: entity.FormTypePresentParticiple, wantIrregular: false},
		{name: "regular pres part ee+ing (agree→agreeing)", lemma: "agree", form: "agreeing", formType: entity.FormTypePresentParticiple, wantIrregular: false},
		// Regular: CVC double + ing
		{name: "regular pres part CVC (run→running)", lemma: "run", form: "running", formType: entity.FormTypePresentParticiple, wantIrregular: false},
		{name: "regular pres part CVC (swim→swimming)", lemma: "swim", form: "swimming", formType: entity.FormTypePresentParticiple, wantIrregular: false},
		{name: "regular pres part CVC (sit→sitting)", lemma: "sit", form: "sitting", formType: entity.FormTypePresentParticiple, wantIrregular: false},
		// Regular: -ie → -ying
		{name: "regular pres part ie→ying (die→dying)", lemma: "die", form: "dying", formType: entity.FormTypePresentParticiple, wantIrregular: false},
		{name: "regular pres part ie→ying (lie→lying)", lemma: "lie", form: "lying", formType: entity.FormTypePresentParticiple, wantIrregular: false},

		// ===== THIRD PERSON SINGULAR =====

		// Regular: +s
		{name: "regular 3ps +s (walk→walks)", lemma: "walk", form: "walks", formType: entity.FormTypeThirdPersonSingular, wantIrregular: false},
		{name: "regular 3ps +s (run→runs)", lemma: "run", form: "runs", formType: entity.FormTypeThirdPersonSingular, wantIrregular: false},
		// Regular: +es (sibilant / -o)
		{name: "regular 3ps +es (go→goes)", lemma: "go", form: "goes", formType: entity.FormTypeThirdPersonSingular, wantIrregular: false},
		{name: "regular 3ps +es (watch→watches)", lemma: "watch", form: "watches", formType: entity.FormTypeThirdPersonSingular, wantIrregular: false},
		{name: "regular 3ps +es (do→does)", lemma: "do", form: "does", formType: entity.FormTypeThirdPersonSingular, wantIrregular: false},
		// Regular: consonant+y → ies
		{name: "regular 3ps consonant+y→ies (study→studies)", lemma: "study", form: "studies", formType: entity.FormTypeThirdPersonSingular, wantIrregular: false},
		{name: "regular 3ps consonant+y→ies (fly→flies)", lemma: "fly", form: "flies", formType: entity.FormTypeThirdPersonSingular, wantIrregular: false},
		// Regular: vowel+y → +s
		{name: "regular 3ps vowel+y→s (play→plays)", lemma: "play", form: "plays", formType: entity.FormTypeThirdPersonSingular, wantIrregular: false},
		// Irregular: suppletive
		{name: "irregular 3ps (be→is)", lemma: "be", form: "is", formType: entity.FormTypeThirdPersonSingular, wantIrregular: true},
		{name: "irregular 3ps (have→has)", lemma: "have", form: "has", formType: entity.FormTypeThirdPersonSingular, wantIrregular: true},

		// ===== COMPARATIVE =====

		// Regular: +er
		{name: "regular comp +er (tall→taller)", lemma: "tall", form: "taller", formType: entity.FormTypeComparative, wantIrregular: false},
		{name: "regular comp +er (long→longer)", lemma: "long", form: "longer", formType: entity.FormTypeComparative, wantIrregular: false},
		{name: "regular comp +er (fast→faster)", lemma: "fast", form: "faster", formType: entity.FormTypeComparative, wantIrregular: false},
		// Regular: silent-e +r
		{name: "regular comp e+r (nice→nicer)", lemma: "nice", form: "nicer", formType: entity.FormTypeComparative, wantIrregular: false},
		{name: "regular comp e+r (large→larger)", lemma: "large", form: "larger", formType: entity.FormTypeComparative, wantIrregular: false},
		// Regular: consonant+y → ier
		{name: "regular comp consonant+y→ier (happy→happier)", lemma: "happy", form: "happier", formType: entity.FormTypeComparative, wantIrregular: false},
		{name: "regular comp consonant+y→ier (easy→easier)", lemma: "easy", form: "easier", formType: entity.FormTypeComparative, wantIrregular: false},
		// Regular: CVC double + er
		{name: "regular comp CVC (big→bigger)", lemma: "big", form: "bigger", formType: entity.FormTypeComparative, wantIrregular: false},
		{name: "regular comp CVC (hot→hotter)", lemma: "hot", form: "hotter", formType: entity.FormTypeComparative, wantIrregular: false},
		// Irregular: suppletive
		{name: "irregular comp (good→better)", lemma: "good", form: "better", formType: entity.FormTypeComparative, wantIrregular: true},
		{name: "irregular comp (bad→worse)", lemma: "bad", form: "worse", formType: entity.FormTypeComparative, wantIrregular: true},
		{name: "irregular comp (far→farther)", lemma: "far", form: "farther", formType: entity.FormTypeComparative, wantIrregular: true},
		{name: "irregular comp (far→further)", lemma: "far", form: "further", formType: entity.FormTypeComparative, wantIrregular: true},
		{name: "irregular comp (many→more)", lemma: "many", form: "more", formType: entity.FormTypeComparative, wantIrregular: true},
		{name: "irregular comp (little→less)", lemma: "little", form: "less", formType: entity.FormTypeComparative, wantIrregular: true},

		// ===== SUPERLATIVE =====

		// Regular: +est
		{name: "regular super +est (tall→tallest)", lemma: "tall", form: "tallest", formType: entity.FormTypeSuperlative, wantIrregular: false},
		{name: "regular super +est (long→longest)", lemma: "long", form: "longest", formType: entity.FormTypeSuperlative, wantIrregular: false},
		// Regular: silent-e +st
		{name: "regular super e+st (nice→nicest)", lemma: "nice", form: "nicest", formType: entity.FormTypeSuperlative, wantIrregular: false},
		// Regular: consonant+y → iest
		{name: "regular super consonant+y→iest (happy→happiest)", lemma: "happy", form: "happiest", formType: entity.FormTypeSuperlative, wantIrregular: false},
		// Regular: CVC double + est
		{name: "regular super CVC (big→biggest)", lemma: "big", form: "biggest", formType: entity.FormTypeSuperlative, wantIrregular: false},
		{name: "regular super CVC (hot→hottest)", lemma: "hot", form: "hottest", formType: entity.FormTypeSuperlative, wantIrregular: false},
		// Irregular: suppletive
		{name: "irregular super (good→best)", lemma: "good", form: "best", formType: entity.FormTypeSuperlative, wantIrregular: true},
		{name: "irregular super (bad→worst)", lemma: "bad", form: "worst", formType: entity.FormTypeSuperlative, wantIrregular: true},
		{name: "irregular super (far→farthest)", lemma: "far", form: "farthest", formType: entity.FormTypeSuperlative, wantIrregular: true},
		{name: "irregular super (many→most)", lemma: "many", form: "most", formType: entity.FormTypeSuperlative, wantIrregular: true},
		{name: "irregular super (little→least)", lemma: "little", form: "least", formType: entity.FormTypeSuperlative, wantIrregular: true},

		// ===== EDGE CASES =====

		{name: "empty lemma", lemma: "", form: "test", formType: entity.FormTypePlural, wantIrregular: false},
		{name: "empty form", lemma: "test", form: "", formType: entity.FormTypePlural, wantIrregular: false},
		{name: "lemma form type (same as lemma)", lemma: "test", form: "test", formType: entity.FormTypeLemma, wantIrregular: false},
		// Case insensitive
		{name: "case insensitive (Walk→Walked)", lemma: "Walk", form: "Walked", formType: entity.FormTypePast, wantIrregular: false},
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
