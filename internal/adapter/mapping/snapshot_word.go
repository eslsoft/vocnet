package mapping

import (
	"sort"
	"strings"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/eslsoft/vocnet/internal/entity"
	dictv1 "github.com/eslsoft/vocnet/pkg/api/dict/v1"
)

// relationTypeMap maps snapshot relation type strings to proto enum values.
var relationTypeMap = map[string]dictv1.RelationType{
	"synonym":      dictv1.RelationType_RELATION_TYPE_SYNONYM,
	"antonym":      dictv1.RelationType_RELATION_TYPE_ANTONYM,
	"hypernym":     dictv1.RelationType_RELATION_TYPE_HYPERNYM,
	"hyponym":      dictv1.RelationType_RELATION_TYPE_HYPONYM,
	"association":  dictv1.RelationType_RELATION_TYPE_ASSOCIATION,
	"cause_effect": dictv1.RelationType_RELATION_TYPE_CAUSE_EFFECT,
	"part_whole":   dictv1.RelationType_RELATION_TYPE_PART_WHOLE,
	"derivative":   dictv1.RelationType_RELATION_TYPE_DERIVATIVE,
}

// formTypeFromString maps snapshot form_type strings to entity.FormType.
var formTypeFromString = map[string]entity.FormType{
	"LEMMA":                 entity.FormTypeLemma,
	"PLURAL":                entity.FormTypePlural,
	"PAST":                  entity.FormTypePast,
	"PAST_PARTICIPLE":       entity.FormTypePastParticiple,
	"PRESENT_PARTICIPLE":    entity.FormTypePresentParticiple,
	"THIRD_PERSON_SINGULAR": entity.FormTypeThirdPersonSingular,
	"COMPARATIVE":           entity.FormTypeComparative,
	"SUPERLATIVE":           entity.FormTypeSuperlative,
	"IMPERATIVE":            entity.FormTypeImperative,
	"SUBJUNCTIVE":           entity.FormTypeSubjunctive,
	"GERUND":                entity.FormTypeGerund,
	"SHORT_FORM":            entity.FormTypeShortForm,
}

// SnapshotToPbWord converts a LemmaSnapshot to dictv1.Word.
// queriedTerm: the user's query term (may be lemma or inflected form).
func SnapshotToPbWord(snapshot *entity.LemmaSnapshot, queriedTerm string) *dictv1.Word {
	if snapshot == nil {
		return nil
	}

	queriedTerm = strings.TrimSpace(queriedTerm)
	if queriedTerm == "" {
		queriedTerm = snapshot.Surface
	}

	// Find the matching form for the queried term
	queriedForm := findSnapshotFormByText(snapshot.Payload.Forms, queriedTerm)
	isQueriedLemma := queriedForm != nil && strings.ToUpper(queriedForm.FormType) == "LEMMA"

	if isQueriedLemma || queriedForm == nil {
		return buildSnapshotLemmaView(snapshot, queriedForm, queriedTerm)
	}
	return buildSnapshotFormView(snapshot, queriedForm, queriedTerm)
}

func buildSnapshotLemmaView(snapshot *entity.LemmaSnapshot, queriedForm *entity.LemmaSnapshotForm, queriedTerm string) *dictv1.Word {
	// Determine display term
	displayTerm := queriedTerm
	if queriedForm != nil {
		displayTerm = queriedForm.Surface
	} else if displayTerm == "" {
		displayTerm = snapshot.Surface
	}

	// Get phonetics from the queried form or lemma form
	var phonetics []entity.Phonetic
	if queriedForm != nil {
		phonetics = queriedForm.Phonetics
	} else {
		// Try to find lemma form for phonetics
		for _, form := range snapshot.Payload.Forms {
			if strings.ToUpper(form.FormType) == "LEMMA" {
				phonetics = form.Phonetics
				break
			}
		}
	}

	// Build related forms (exclude the queried form)
	relatedForms := buildSnapshotRelatedForms(snapshot.Payload.Forms, queriedForm)

	// Get syllables from form or snapshot
	syllables := snapshot.Payload.Syllables
	if queriedForm != nil && len(queriedForm.Syllables) > 0 {
		syllables = queriedForm.Syllables
	}

	word := &dictv1.Word{
		Id:           snapshot.LemmaID,
		Term:         displayTerm,
		TermType:     dictv1.FormType_FORM_TYPE_LEMMA,
		Lemma:        nil, // Not set for lemma view
		Language:     ToPbLanguage(entity.ParseLanguage(snapshot.Language)),
		Phonetics:    mapSnapshotPhonetics(phonetics),
		Meanings:     buildSnapshotMeanings(snapshot.Payload.Lexemes),
		RelatedForms: relatedForms,
		Syllables:    syllables,
		Categories:   snapshot.Payload.Categories,
		Relations:    buildSnapshotRelations(snapshot.Payload.Relations),
		Level:        snapshot.Level,
		Irregular:    false,
		Completeness: int32(snapshot.Quality.Overall * 100),
	}

	setSnapshotTimestamps(word, snapshot)
	return word
}

func buildSnapshotFormView(snapshot *entity.LemmaSnapshot, queriedForm *entity.LemmaSnapshotForm, queriedTerm string) *dictv1.Word {
	lemmaText := snapshot.Surface

	// Get phonetics from the queried form
	var phonetics []entity.Phonetic
	if queriedForm != nil {
		phonetics = queriedForm.Phonetics
	}

	// Map form type
	formType := entity.FormTypeUnspecified
	if queriedForm != nil {
		if ft, ok := formTypeFromString[strings.ToUpper(queriedForm.FormType)]; ok {
			formType = ft
		}
	}

	// Get syllables from form or snapshot
	syllables := snapshot.Payload.Syllables
	if queriedForm != nil && len(queriedForm.Syllables) > 0 {
		syllables = queriedForm.Syllables
	}

	// Determine term to display
	term := queriedTerm
	if queriedForm != nil {
		term = queriedForm.Surface
	}

	// Check if irregular
	isIrregular := false
	if queriedForm != nil {
		isIrregular = queriedForm.IsIrregular
	}

	// Build related forms (exclude the queried form)
	relatedForms := buildSnapshotRelatedForms(snapshot.Payload.Forms, queriedForm)

	word := &dictv1.Word{
		Id:           snapshot.LemmaID,
		Term:         term,
		TermType:     toPbFormType(formType),
		Lemma:        &lemmaText,
		Language:     ToPbLanguage(entity.ParseLanguage(snapshot.Language)),
		Phonetics:    mapSnapshotPhonetics(phonetics),
		Meanings:     buildSnapshotMeanings(snapshot.Payload.Lexemes),
		RelatedForms: relatedForms,
		Syllables:    syllables,
		Categories:   snapshot.Payload.Categories,
		Relations:    buildSnapshotRelations(snapshot.Payload.Relations),
		Level:        snapshot.Level,
		Irregular:    isIrregular,
		Completeness: int32(snapshot.Quality.Overall * 100),
	}

	setSnapshotTimestamps(word, snapshot)
	return word
}

// findSnapshotFormByText finds a form by its surface text (case-insensitive match).
func findSnapshotFormByText(forms []entity.LemmaSnapshotForm, text string) *entity.LemmaSnapshotForm {
	if text == "" || len(forms) == 0 {
		return nil
	}
	normalized := strings.ToLower(text)

	// Priority 1: Exact surface match
	for i := range forms {
		if forms[i].Surface == text {
			return &forms[i]
		}
	}

	// Priority 2: Normalized match
	for i := range forms {
		if strings.ToLower(forms[i].Surface) == normalized {
			return &forms[i]
		}
	}
	return nil
}

func buildSnapshotRelatedForms(allForms []entity.LemmaSnapshotForm, excludeForm *entity.LemmaSnapshotForm) []*dictv1.RelatedForm {
	seen := make(map[string]bool)
	var forms []*dictv1.RelatedForm

	for _, form := range allForms {
		// Exclude the form being displayed
		if excludeForm != nil && form.Surface == excludeForm.Surface && form.FormType == excludeForm.FormType {
			continue
		}

		key := strings.ToLower(form.Surface) + form.FormType
		if seen[key] {
			continue
		}
		seen[key] = true

		formType := entity.FormTypeUnspecified
		if ft, ok := formTypeFromString[strings.ToUpper(form.FormType)]; ok {
			formType = ft
		}

		forms = append(forms, &dictv1.RelatedForm{
			Term:      form.Surface,
			FormType:  toPbFormType(formType),
			Irregular: form.IsIrregular,
			Syllables: form.Syllables,
		})
	}

	// Sort forms for consistent output
	sort.Slice(forms, func(i, j int) bool {
		if forms[i].Term == forms[j].Term {
			return forms[i].FormType < forms[j].FormType
		}
		return forms[i].Term < forms[j].Term
	})
	return forms
}

func buildSnapshotMeanings(lexemes []entity.LemmaSnapshotLexeme) []*dictv1.Meaning {
	meanings := make([]*dictv1.Meaning, 0, len(lexemes))

	for _, lex := range lexemes {
		meaning := &dictv1.Meaning{
			LexemeId: lex.ExternalID,
			Pos:      lex.POS,
		}

		for _, sense := range lex.Senses {
			meaning.Definitions = append(meaning.Definitions, &dictv1.Definition{
				Language: ToPbLanguage(entity.ParseLanguage(sense.Language)),
				Gloss:    sense.Gloss,
			})

			for _, ex := range sense.Examples {
				meaning.Examples = append(meaning.Examples, &dictv1.Sentence{
					Text: ex,
				})
			}
		}

		meanings = append(meanings, meaning)
	}

	return meanings
}

func buildSnapshotRelations(relations []entity.LemmaSnapshotRelation) []*dictv1.Relation {
	result := make([]*dictv1.Relation, 0, len(relations))

	for _, rel := range relations {
		relType := dictv1.RelationType_RELATION_TYPE_UNSPECIFIED
		if rt, ok := relationTypeMap[strings.ToLower(rel.RelationType)]; ok {
			relType = rt
		}

		result = append(result, &dictv1.Relation{
			Type:       relType,
			TargetWord: rel.TargetTerm,
			Strength:   rel.Strength,
			Provider:   rel.Provider,
		})
	}

	return result
}

func mapSnapshotPhonetics(phonetics []entity.Phonetic) []*dictv1.Phonetic {
	out := make([]*dictv1.Phonetic, 0, len(phonetics))
	for _, p := range phonetics {
		out = append(out, &dictv1.Phonetic{
			Ipa:     p.IPA,
			Dialect: p.Dialect,
		})
	}
	return out
}

func setSnapshotTimestamps(word *dictv1.Word, snapshot *entity.LemmaSnapshot) {
	if !snapshot.CreatedAt.IsZero() {
		word.CreatedAt = timestamppb.New(snapshot.CreatedAt)
	}
	if !snapshot.UpdatedAt.IsZero() {
		word.UpdatedAt = timestamppb.New(snapshot.UpdatedAt)
	}
}
