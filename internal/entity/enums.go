package entity

// FormType enumerates normalized surface-form categories.
type FormType string

const (
	FormTypeUnspecified         FormType = ""
	FormTypeLemma               FormType = "LEMMA"
	FormTypePlural              FormType = "PLURAL"
	FormTypePast                FormType = "PAST"
	FormTypePastParticiple      FormType = "PAST_PARTICIPLE"
	FormTypePresentParticiple   FormType = "PRESENT_PARTICIPLE"
	FormTypeThirdPersonSingular FormType = "THIRD_PERSON_SINGULAR"
	FormTypeComparative         FormType = "COMPARATIVE"
	FormTypeSuperlative         FormType = "SUPERLATIVE"
	FormTypeImperative          FormType = "IMPERATIVE"
	FormTypeSubjunctive         FormType = "SUBJUNCTIVE"
	FormTypeGerund              FormType = "GERUND"
	FormTypeShortForm           FormType = "SHORT_FORM"
)
