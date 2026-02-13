package contrib

import "github.com/eslsoft/vocnet/internal/repository"

// JSON-RPC 2.0 protocol types for external data source communication.

// Request is a JSON-RPC 2.0 request.
type Request struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int    `json:"id"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

// Response is a JSON-RPC 2.0 response.
type Response struct {
	JSONRPC string        `json:"jsonrpc"`
	ID      int           `json:"id"`
	Result  any           `json:"result,omitempty"`
	Error   *RPCError     `json:"error,omitempty"`
}

// RPCError is a JSON-RPC 2.0 error object.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *RPCError) Error() string {
	return e.Message
}

// InitializeResult is the response payload from the "initialize" method.
type InitializeResult struct {
	Name         string   `json:"name"`
	Version      string   `json:"version"`
	Languages    []string `json:"languages"`
	Capabilities []string `json:"capabilities"`
	Stage        string   `json:"stage"`
}

// LookupParams is the request payload for the "lookup" method.
type LookupParams struct {
	Term     string         `json:"term"`
	Language string         `json:"language"`
	Context  *LookupContext `json:"context,omitempty"`
}

// LookupContext carries pipeline state to the external source.
type LookupContext struct {
	Lexemes   []LookupLexeme   `json:"lexemes,omitempty"`
	Forms     []LookupForm     `json:"forms,omitempty"`
	Relations []LookupRelation `json:"relations,omitempty"`
	Lemma     *LookupLemma     `json:"lemma,omitempty"`
}

// LookupLexeme is a simplified lexeme for the contrib protocol.
type LookupLexeme struct {
	ExternalID   string   `json:"external_id"`
	Language     string   `json:"language"`
	PartOfSpeech string   `json:"part_of_speech"`
	SenseGloss   string   `json:"sense_gloss,omitempty"`
	Categories   []string `json:"categories,omitempty"`
}

// LookupForm is a simplified form for the contrib protocol.
type LookupForm struct {
	Surface  string `json:"surface"`
	FormType string `json:"form_type"`
}

// LookupRelation is a simplified relation for the contrib protocol.
type LookupRelation struct {
	TargetTerm   string  `json:"target_term"`
	RelationType string  `json:"relation_type"`
	Provider     string  `json:"provider"`
	Strength     float64 `json:"strength"`
}

// LookupLemma is a simplified lemma for the contrib protocol.
type LookupLemma struct {
	Surface string `json:"surface"`
	Level   string `json:"level,omitempty"`
}

// LookupResult is the response payload from the "lookup" method.
type LookupResult struct {
	Lexemes     []ResultLexeme     `json:"lexemes,omitempty"`
	Forms       []ResultForm       `json:"forms,omitempty"`
	Relations   []ResultRelation   `json:"relations,omitempty"`
	LemmaUpdate *ResultLemmaUpdate `json:"lemma_update,omitempty"`
	Evidence    *ResultEvidence     `json:"evidence,omitempty"`

	FormsByLexeme map[string][]ResultForm `json:"forms_by_lexeme,omitempty"`
}

// ResultLexeme is a lexeme returned by the contrib source.
type ResultLexeme struct {
	ExternalID   string         `json:"external_id"`
	Language     string         `json:"language"`
	PartOfSpeech string         `json:"part_of_speech"`
	EntryType    string         `json:"entry_type,omitempty"`
	SenseGloss   string         `json:"sense_gloss,omitempty"`
	Senses       []ResultSense  `json:"senses,omitempty"`
	Categories   []string       `json:"categories,omitempty"`
	Completeness int32          `json:"completeness,omitempty"`
}

// ResultSense is a sense returned by the contrib source.
type ResultSense struct {
	Language string `json:"language"`
	Gloss    string `json:"gloss"`
}

// ResultForm is a form returned by the contrib source.
type ResultForm struct {
	Surface     string           `json:"surface"`
	FormType    string           `json:"form_type"`
	IsIrregular bool             `json:"is_irregular,omitempty"`
	Phonetics   []ResultPhonetic `json:"phonetics,omitempty"`
	Syllables   []string         `json:"syllables,omitempty"`
}

// ResultPhonetic is a phonetic entry returned by the contrib source.
type ResultPhonetic struct {
	IPA     string `json:"ipa"`
	Dialect string `json:"dialect,omitempty"`
}

// ResultRelation is a relation returned by the contrib source.
type ResultRelation struct {
	SourceExternalID string  `json:"source_external_id,omitempty"`
	TargetRef        string  `json:"target_ref,omitempty"`
	TargetTerm       string  `json:"target_term"`
	RelationType     string  `json:"relation_type"`
	Provider         string  `json:"provider"`
	Strength         float64 `json:"strength"`
	SenseMapped      bool    `json:"sense_mapped,omitempty"`
}

// ResultLemmaUpdate carries lemma-level metadata updates.
type ResultLemmaUpdate struct {
	Level       string            `json:"level,omitempty"`
	Frequencies []ResultFrequency `json:"frequencies,omitempty"`
}

// ResultFrequency is a frequency entry from the contrib source.
type ResultFrequency struct {
	Corpus string `json:"corpus"`
	Count  int64  `json:"count"`
}

// ResultEvidence carries provenance data from the contrib source.
type ResultEvidence struct {
	Provider      string         `json:"provider"`
	Phase         int32          `json:"phase"`
	Content       map[string]any `json:"content,omitempty"`
	SchemaVersion string         `json:"schema_version"`
}

// toSourceManifest converts InitializeResult to a SourceManifest.
func (r *InitializeResult) toSourceManifest() repository.SourceManifest {
	caps := make([]repository.SourceCapability, 0, len(r.Capabilities))
	for _, c := range r.Capabilities {
		caps = append(caps, repository.SourceCapability(c))
	}
	return repository.SourceManifest{
		Name:         r.Name,
		Version:      r.Version,
		Kind:         repository.SourceKindContrib,
		Languages:    r.Languages,
		Capabilities: caps,
		Stage:        r.Stage,
	}
}
