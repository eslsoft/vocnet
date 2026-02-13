package pipeline

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/eslsoft/vocnet/internal/entity"
)

// PartialDataContract defines validation rules for partial data from sources.
// Sources are NOT required to provide all fields, but fields they DO provide
// must meet the contract standards.
type PartialDataContract struct {
	Version string // Contract version, e.g., "v1"
}

// ContractViolation represents a single contract violation.
type ContractViolation struct {
	Field   string // Field path, e.g., "lexemes[0].part_of_speech"
	Rule    string // Violated rule, e.g., "must not be unspecified"
	Value   string // Actual value that violated the rule
	Message string // Human-readable explanation
}

// ContractViolationError aggregates all violations from a source.
type ContractViolationError struct {
	Provider   string
	Violations []ContractViolation
}

func (e *ContractViolationError) Error() string {
	return fmt.Sprintf("provider %s violated data contract: %d violations", e.Provider, len(e.Violations))
}

// ContractValidator validates that partial data from sources meets contract standards.
type ContractValidator struct {
	ipaPattern      *regexp.Regexp
	dialectPattern  *regexp.Regexp
	uriPattern      *regexp.Regexp
}

func NewContractValidator() *ContractValidator {
	return &ContractValidator{
		// IPA must contain phonetic symbols (basic check)
		ipaPattern: regexp.MustCompile(`^[\[\]/][a-zɑɔəɛɪʊʌæɒʃʒθðŋˈˌːˑ̩̆ʰʷʲ̃ ]+[\[\]/]?$`),
		// Dialect must be ISO 639-1 format: en-US, en-GB, zh-CN, etc.
		dialectPattern: regexp.MustCompile(`^[a-z]{2}(-[A-Z]{2})?$`),
		// URI pattern for target refs
		uriPattern: regexp.MustCompile(`^[a-z]+://[^\s]+$`),
	}
}

// ValidateLexeme validates a lexeme fragment.
func (cv *ContractValidator) ValidateLexeme(lexeme *entity.Lexeme, index int) []ContractViolation {
	var violations []ContractViolation
	prefix := fmt.Sprintf("lexemes[%d]", index)

	// Language: if provided, must be valid
	if lexeme.Language != "" && lexeme.Language == entity.LanguageUnspecified {
		violations = append(violations, ContractViolation{
			Field:   prefix + ".language",
			Rule:    "must be valid language code",
			Value:   string(lexeme.Language),
			Message: "Invalid language code",
		})
	}

	// PartOfSpeech: if provided, must not be Unspecified
	if lexeme.PartOfSpeech == entity.PartOfSpeechUnspecified {
		violations = append(violations, ContractViolation{
			Field:   prefix + ".part_of_speech",
			Rule:    "must not be unspecified",
			Value:   "unspecified",
			Message: "Part of speech cannot be unspecified; source must either provide valid POS or omit this lexeme",
		})
	}

	// Senses: if provided, each must be non-empty
	for i, sense := range lexeme.Senses {
		if strings.TrimSpace(sense.Gloss) == "" {
			violations = append(violations, ContractViolation{
				Field:   fmt.Sprintf("%s.senses[%d]", prefix, i),
				Rule:    "must be non-empty",
				Value:   sense.Gloss,
				Message: "Sense definition cannot be empty",
			})
		}
	}

	// Categories: if provided, each must be non-empty
	for i, category := range lexeme.Categories {
		if strings.TrimSpace(category) == "" {
			violations = append(violations, ContractViolation{
				Field:   fmt.Sprintf("%s.categories[%d]", prefix, i),
				Rule:    "must be non-empty",
				Value:   category,
				Message: "Category cannot be empty",
			})
		}
	}

	return violations
}

// ValidateForm validates a form fragment.
func (cv *ContractValidator) ValidateForm(form *entity.LemmaForm, index int) []ContractViolation {
	var violations []ContractViolation
	prefix := fmt.Sprintf("forms[%d]", index)

	// Surface: must be non-empty
	if strings.TrimSpace(form.Surface) == "" {
		violations = append(violations, ContractViolation{
			Field:   prefix + ".surface",
			Rule:    "must be non-empty",
			Value:   form.Surface,
			Message: "Form surface cannot be empty",
		})
	}

	// Phonetics: if provided, each must have valid IPA and dialect
	for i, phonetic := range form.Phonetics {
		phoneticPrefix := fmt.Sprintf("%s.phonetics[%d]", prefix, i)

		// IPA: if provided, must match IPA pattern
		if phonetic.IPA != "" && !cv.ipaPattern.MatchString(phonetic.IPA) {
			violations = append(violations, ContractViolation{
				Field:   phoneticPrefix + ".ipa",
				Rule:    "must be valid IPA format",
				Value:   phonetic.IPA,
				Message: "IPA must be enclosed in slashes or brackets and contain phonetic symbols",
			})
		}

		// Dialect: if provided, must be ISO 639 format
		if phonetic.Dialect != "" && !cv.dialectPattern.MatchString(phonetic.Dialect) {
			violations = append(violations, ContractViolation{
				Field:   phoneticPrefix + ".dialect",
				Rule:    "must be ISO 639 format",
				Value:   phonetic.Dialect,
				Message: "Dialect must be in ISO 639 format (e.g., en-US, en-GB, zh-CN), not BrE/NAmE/US/UK",
			})
		}
	}

	// Syllables: if provided, each must be non-empty
	for i, syllable := range form.Syllables {
		if strings.TrimSpace(syllable) == "" {
			violations = append(violations, ContractViolation{
				Field:   fmt.Sprintf("%s.syllables[%d]", prefix, i),
				Rule:    "must be non-empty",
				Value:   syllable,
				Message: "Syllable cannot be empty",
			})
		}
	}

	return violations
}

// ValidateRelation validates a relation fragment.
func (cv *ContractValidator) ValidateRelation(relation *entity.SemanticRelation, index int) []ContractViolation {
	var violations []ContractViolation
	prefix := fmt.Sprintf("relations[%d]", index)

	// RelationType: must not be empty
	if strings.TrimSpace(relation.RelationType) == "" {
		violations = append(violations, ContractViolation{
			Field:   prefix + ".relation_type",
			Rule:    "must not be empty",
			Value:   relation.RelationType,
			Message: "Relation type must be specified",
		})
	}

	// TargetTerm: must be non-empty
	if strings.TrimSpace(relation.TargetTerm) == "" {
		violations = append(violations, ContractViolation{
			Field:   prefix + ".target_term",
			Rule:    "must be non-empty",
			Value:   relation.TargetTerm,
			Message: "Target term cannot be empty",
		})
	}

	// TargetRef: if provided, must be valid URI
	if relation.TargetRef != "" && !cv.uriPattern.MatchString(relation.TargetRef) {
		violations = append(violations, ContractViolation{
			Field:   prefix + ".target_ref",
			Rule:    "must be valid URI",
			Value:   relation.TargetRef,
			Message: "Target reference must be valid URI format (e.g., wikidata://lexeme/L123, conceptnet://c/en/dog)",
		})
	}

	// Strength: must be in [0, 1] range
	if relation.Strength < 0.0 || relation.Strength > 1.0 {
		violations = append(violations, ContractViolation{
			Field:   prefix + ".strength",
			Rule:    "must be in range [0.0, 1.0]",
			Value:   fmt.Sprintf("%.2f", relation.Strength),
			Message: "Relation strength must be normalized to [0.0, 1.0]",
		})
	}

	// Provider: must be non-empty
	if strings.TrimSpace(relation.Provider) == "" {
		violations = append(violations, ContractViolation{
			Field:   prefix + ".provider",
			Rule:    "must be non-empty",
			Value:   relation.Provider,
			Message: "Provider name must be specified",
		})
	}

	return violations
}

// ValidateSourceResult validates the complete result from a source.
func (cv *ContractValidator) ValidateSourceResult(result interface{}, provider string) error {
	var allViolations []ContractViolation

	// Type assertion to extract fields
	r, ok := result.(*ProcessResult)
	if !ok {
		return nil // Not a ProcessResult, skip validation
	}

	// Validate lexemes
	for i, lexeme := range r.Lexemes {
		violations := cv.ValidateLexeme(lexeme, i)
		allViolations = append(allViolations, violations...)
	}

	// Validate forms
	for i, form := range r.Forms {
		violations := cv.ValidateForm(form, i)
		allViolations = append(allViolations, violations...)
	}

	// Validate relations
	for i, relation := range r.Relations {
		violations := cv.ValidateRelation(relation, i)
		allViolations = append(allViolations, violations...)
	}

	if len(allViolations) > 0 {
		return &ContractViolationError{
			Provider:   provider,
			Violations: allViolations,
		}
	}

	return nil
}
