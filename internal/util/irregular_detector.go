package util

import (
	"strings"
	"unicode"

	"github.com/eslsoft/vocnet/internal/entity"
)

// IsIrregularForm determines if a given inflected form is irregular
// based on standard English morphological rules.
func IsIrregularForm(lemma, form string, formType entity.FormType) bool {
	if lemma == "" || form == "" {
		return false
	}

	lemma = strings.ToLower(strings.TrimSpace(lemma))
	form = strings.ToLower(strings.TrimSpace(form))

	// If they're the same, it depends on the form type
	if lemma == form {
		switch formType {
		case entity.FormTypePlural:
			// Zero plural (sheep→sheep, fish→fish, deer→deer) is irregular
			return true
		case entity.FormTypePast, entity.FormTypePastParticiple:
			// "cut" → "cut" is irregular (should be "cutted")
			return true
		default:
			return false
		}
	}

	switch formType {
	case entity.FormTypePlural:
		return !isRegularPlural(lemma, form)

	case entity.FormTypePast:
		return !isRegularPast(lemma, form)

	case entity.FormTypePastParticiple:
		return !isRegularPastParticiple(lemma, form)

	case entity.FormTypePresentParticiple:
		return !isRegularPresentParticiple(lemma, form)

	case entity.FormTypeThirdPersonSingular:
		return !isRegularThirdPerson(lemma, form)

	case entity.FormTypeComparative:
		return !isRegularComparative(lemma, form)

	case entity.FormTypeSuperlative:
		return !isRegularSuperlative(lemma, form)

	default:
		// Unknown form type, assume irregular
		return false
	}
}

// isRegularPlural checks if the plural form follows standard English rules
func isRegularPlural(singular, plural string) bool {
	// Rule 1: Standard +s (cat → cats)
	if plural == singular+"s" {
		return true
	}

	// Rule 2: -s, -ss, -x, -z, -ch, -sh endings → +es (box → boxes)
	if strings.HasSuffix(singular, "s") || strings.HasSuffix(singular, "ss") ||
		strings.HasSuffix(singular, "x") || strings.HasSuffix(singular, "z") ||
		strings.HasSuffix(singular, "ch") || strings.HasSuffix(singular, "sh") {
		if plural == singular+"es" {
			return true
		}
	}

	// Rule 3: Consonant + y → -y + ies (baby → babies)
	if len(singular) >= 2 && strings.HasSuffix(singular, "y") {
		beforeY := rune(singular[len(singular)-2])
		if !isVowel(beforeY) {
			stem := singular[:len(singular)-1]
			if plural == stem+"ies" {
				return true
			}
		}
	}

	// Rule 4: Vowel + y → +s (boy → boys)
	if len(singular) >= 2 && strings.HasSuffix(singular, "y") {
		beforeY := rune(singular[len(singular)-2])
		if isVowel(beforeY) && plural == singular+"s" {
			return true
		}
	}

	// Rule 5: -o → +es for some words, but many are +s (potato → potatoes, photo → photos)
	// This is ambiguous, so we'll accept both
	if strings.HasSuffix(singular, "o") {
		if plural == singular+"es" || plural == singular+"s" {
			return true
		}
	}

	return false
}

// isRegularPast checks if the past tense form follows standard English rules
func isRegularPast(base, past string) bool {
	return isRegularSuffixForm(base, past, "ed", "d", "ied", "ed")
}

// isRegularPastParticiple checks if the past participle follows standard English rules
func isRegularPastParticiple(base, participle string) bool {
	return isRegularSuffixForm(base, participle, "ed", "d", "ied", "ed")
}

func isRegularSuffixForm(base, inflected, standardSuffix, silentESuffix, ySuffix, doubledSuffix string) bool {
	if inflected == base+standardSuffix {
		return true
	}

	if strings.HasSuffix(base, "e") && inflected == base+silentESuffix {
		return true
	}

	if len(base) >= 2 && strings.HasSuffix(base, "y") {
		beforeY := rune(base[len(base)-2])
		if !isVowel(beforeY) {
			stem := base[:len(base)-1]
			if inflected == stem+ySuffix {
				return true
			}
		}
	}

	if len(base) >= 3 {
		lastChar := rune(base[len(base)-1])
		secondLastChar := rune(base[len(base)-2])
		thirdLastChar := rune(base[len(base)-3])

		if !isVowel(thirdLastChar) && isVowel(secondLastChar) && !isVowel(lastChar) {
			if lastChar != 'w' && lastChar != 'x' && lastChar != 'y' {
				doubled := base + string(lastChar) + doubledSuffix
				if inflected == doubled {
					return true
				}
			}
		}
	}

	return false
}

// isRegularPresentParticiple checks if the -ing form follows standard English rules
func isRegularPresentParticiple(base, participle string) bool {
	// Rule 1: Standard +ing (walk → walking)
	if participle == base+"ing" {
		return true
	}

	// Rule 2: Silent -e → drop e + ing (make → making, bake → baking)
	if strings.HasSuffix(base, "e") && !strings.HasSuffix(base, "ee") {
		stem := base[:len(base)-1]
		if participle == stem+"ing" {
			return true
		}
	}

	// Rule 3: -ee, -oe, -ye → keep e + ing (see → seeing, agree → agreeing)
	if strings.HasSuffix(base, "ee") || strings.HasSuffix(base, "oe") || strings.HasSuffix(base, "ye") {
		if participle == base+"ing" {
			return true
		}
	}

	// Rule 4: CVC pattern → double consonant + ing (run → running, stop → stopping)
	if len(base) >= 3 {
		lastChar := rune(base[len(base)-1])
		secondLastChar := rune(base[len(base)-2])
		thirdLastChar := rune(base[len(base)-3])

		// Check CVC pattern
		if !isVowel(thirdLastChar) && isVowel(secondLastChar) && !isVowel(lastChar) {
			// Exception: don't double w, x, y
			if lastChar != 'w' && lastChar != 'x' && lastChar != 'y' {
				doubled := base + string(lastChar) + "ing"
				if participle == doubled {
					return true
				}
			}
		}
	}

	// Rule 5: -ie → -y + ing (die → dying, lie → lying)
	if strings.HasSuffix(base, "ie") {
		stem := base[:len(base)-2]
		if participle == stem+"ying" {
			return true
		}
	}

	return false
}

// isRegularThirdPerson checks if the 3rd person singular form follows standard rules
func isRegularThirdPerson(base, thirdPerson string) bool {
	// Rule 1: Standard +s (walk → walks, run → runs)
	if thirdPerson == base+"s" {
		return true
	}

	// Rule 2: -s, -ss, -x, -z, -ch, -sh, -o endings → +es (go → goes, watch → watches)
	if strings.HasSuffix(base, "s") || strings.HasSuffix(base, "ss") ||
		strings.HasSuffix(base, "x") || strings.HasSuffix(base, "z") ||
		strings.HasSuffix(base, "ch") || strings.HasSuffix(base, "sh") ||
		strings.HasSuffix(base, "o") {
		if thirdPerson == base+"es" {
			return true
		}
	}

	// Rule 3: Consonant + y → -y + ies (study → studies, try → tries)
	if len(base) >= 2 && strings.HasSuffix(base, "y") {
		beforeY := rune(base[len(base)-2])
		if !isVowel(beforeY) {
			stem := base[:len(base)-1]
			if thirdPerson == stem+"ies" {
				return true
			}
		}
	}

	// Rule 4: Vowel + y → +s (play → plays, buy → buys)
	if len(base) >= 2 && strings.HasSuffix(base, "y") {
		beforeY := rune(base[len(base)-2])
		if isVowel(beforeY) && thirdPerson == base+"s" {
			return true
		}
	}

	return false
}

// isRegularComparative checks if the comparative form follows standard rules
func isRegularComparative(base, comparative string) bool {
	return isRegularSuffixForm(base, comparative, "er", "r", "ier", "er")
}

// isRegularSuperlative checks if the superlative form follows standard rules
func isRegularSuperlative(base, superlative string) bool {
	return isRegularSuffixForm(base, superlative, "est", "st", "iest", "est")
}

// isVowel checks if a character is a vowel (a, e, i, o, u)
func isVowel(ch rune) bool {
	ch = unicode.ToLower(ch)
	return ch == 'a' || ch == 'e' || ch == 'i' || ch == 'o' || ch == 'u'
}
