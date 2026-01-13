package util

import (
	"strings"
	"unicode"

	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

// IsIrregularForm determines if a given inflected form is irregular
// based on standard English morphological rules.
func IsIrregularForm(lemma, form string, formType dictv1.FormType) bool {
	if lemma == "" || form == "" {
		return false
	}

	lemma = strings.ToLower(strings.TrimSpace(lemma))
	form = strings.ToLower(strings.TrimSpace(form))

	// If they're the same, it depends on the form type
	if lemma == form {
		// For some forms, same as lemma can be regular (e.g., "sheep" plural)
		// But we'll consider it regular unless it's a zero-marked inflection
		// that should have a suffix
		switch formType {
		case dictv1.FormType_FORM_TYPE_PLURAL:
			// "sheep" → "sheep" is irregular, but we can't detect without more context
			// We'll be conservative and call it regular
			return false
		case dictv1.FormType_FORM_TYPE_PAST, dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE:
			// "cut" → "cut" is irregular (should be "cutted")
			return true
		default:
			return false
		}
	}

	switch formType {
	case dictv1.FormType_FORM_TYPE_PLURAL:
		return !isRegularPlural(lemma, form)

	case dictv1.FormType_FORM_TYPE_PAST:
		return !isRegularPast(lemma, form)

	case dictv1.FormType_FORM_TYPE_PAST_PARTICIPLE:
		return !isRegularPastParticiple(lemma, form)

	case dictv1.FormType_FORM_TYPE_PRESENT_PARTICIPLE:
		return !isRegularPresentParticiple(lemma, form)

	case dictv1.FormType_FORM_TYPE_THIRD_PERSON_SINGULAR:
		return !isRegularThirdPerson(lemma, form)

	case dictv1.FormType_FORM_TYPE_COMPARATIVE:
		return !isRegularComparative(lemma, form)

	case dictv1.FormType_FORM_TYPE_SUPERLATIVE:
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

	// Rule 5: -f or -fe → -ves (leaf → leaves, knife → knives)
	if strings.HasSuffix(singular, "f") {
		stem := singular[:len(singular)-1]
		if plural == stem+"ves" {
			return true
		}
	}
	if strings.HasSuffix(singular, "fe") {
		stem := singular[:len(singular)-2]
		if plural == stem+"ves" {
			return true
		}
	}

	// Rule 6: -o → +es for some words, but many are +s (potato → potatoes, photo → photos)
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
	return isRegularEdForm(base, past)
}

// isRegularPastParticiple checks if the past participle follows standard English rules
func isRegularPastParticiple(base, participle string) bool {
	return isRegularEdForm(base, participle)
}

// isRegularEdForm checks if a form follows the standard -ed pattern
func isRegularEdForm(base, inflected string) bool {
	// Rule 1: Standard +ed (walk → walked)
	if inflected == base+"ed" {
		return true
	}

	// Rule 2: Silent -e → +d (live → lived, bake → baked)
	if strings.HasSuffix(base, "e") && inflected == base+"d" {
		return true
	}

	// Rule 3: Consonant + y → -y + ied (study → studied, try → tried)
	if len(base) >= 2 && strings.HasSuffix(base, "y") {
		beforeY := rune(base[len(base)-2])
		if !isVowel(beforeY) {
			stem := base[:len(base)-1]
			if inflected == stem+"ied" {
				return true
			}
		}
	}

	// Rule 4: CVC pattern → double consonant + ed (stop → stopped, plan → planned)
	// This is complex - we check if it's a single-syllable word ending in CVC
	if len(base) >= 3 {
		lastChar := rune(base[len(base)-1])
		secondLastChar := rune(base[len(base)-2])
		thirdLastChar := rune(base[len(base)-3])

		// Check CVC pattern: consonant-vowel-consonant
		if !isVowel(thirdLastChar) && isVowel(secondLastChar) && !isVowel(lastChar) {
			// Exception: don't double w, x, y
			if lastChar != 'w' && lastChar != 'x' && lastChar != 'y' {
				doubled := base + string(lastChar) + "ed"
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
	// Rule 1: Standard +er (fast → faster)
	if comparative == base+"er" {
		return true
	}

	// Rule 2: Silent -e → +r (large → larger, nice → nicer)
	if strings.HasSuffix(base, "e") && comparative == base+"r" {
		return true
	}

	// Rule 3: Consonant + y → -y + ier (happy → happier, easy → easier)
	if len(base) >= 2 && strings.HasSuffix(base, "y") {
		beforeY := rune(base[len(base)-2])
		if !isVowel(beforeY) {
			stem := base[:len(base)-1]
			if comparative == stem+"ier" {
				return true
			}
		}
	}

	// Rule 4: CVC pattern → double consonant + er (big → bigger, hot → hotter)
	if len(base) >= 3 {
		lastChar := rune(base[len(base)-1])
		secondLastChar := rune(base[len(base)-2])
		thirdLastChar := rune(base[len(base)-3])

		if !isVowel(thirdLastChar) && isVowel(secondLastChar) && !isVowel(lastChar) {
			if lastChar != 'w' && lastChar != 'x' && lastChar != 'y' {
				doubled := base + string(lastChar) + "er"
				if comparative == doubled {
					return true
				}
			}
		}
	}

	// Note: Multi-syllable adjectives typically use "more + adjective" (more beautiful)
	// These don't have a morphological comparative form, so we won't see them here

	return false
}

// isRegularSuperlative checks if the superlative form follows standard rules
func isRegularSuperlative(base, superlative string) bool {
	// Rule 1: Standard +est (fast → fastest)
	if superlative == base+"est" {
		return true
	}

	// Rule 2: Silent -e → +st (large → largest, nice → nicest)
	if strings.HasSuffix(base, "e") && superlative == base+"st" {
		return true
	}

	// Rule 3: Consonant + y → -y + iest (happy → happiest, easy → easiest)
	if len(base) >= 2 && strings.HasSuffix(base, "y") {
		beforeY := rune(base[len(base)-2])
		if !isVowel(beforeY) {
			stem := base[:len(base)-1]
			if superlative == stem+"iest" {
				return true
			}
		}
	}

	// Rule 4: CVC pattern → double consonant + est (big → biggest, hot → hottest)
	if len(base) >= 3 {
		lastChar := rune(base[len(base)-1])
		secondLastChar := rune(base[len(base)-2])
		thirdLastChar := rune(base[len(base)-3])

		if !isVowel(thirdLastChar) && isVowel(secondLastChar) && !isVowel(lastChar) {
			if lastChar != 'w' && lastChar != 'x' && lastChar != 'y' {
				doubled := base + string(lastChar) + "est"
				if superlative == doubled {
					return true
				}
			}
		}
	}

	return false
}

// isVowel checks if a character is a vowel (a, e, i, o, u)
func isVowel(ch rune) bool {
	ch = unicode.ToLower(ch)
	return ch == 'a' || ch == 'e' || ch == 'i' || ch == 'o' || ch == 'u'
}
