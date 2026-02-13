package contrib

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/eslsoft/vocnet/internal/repository"
)

// ProcessSourceProvider implements SourceProvider by communicating with an external
// process over JSON-RPC 2.0 on stdin/stdout. This enables data sources written
// in any language (Python, Rust, etc.).
type ProcessSourceProvider struct {
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	stdout   *bufio.Reader
	manifest repository.SourceManifest
	logger   *slog.Logger
	mu       sync.Mutex
	nextID   int
}

// NewProcessSourceProvider starts an external process and initializes the JSON-RPC
// connection. The execPath is the path to the executable or script.
// Additional args can be passed as well.
func NewProcessSourceProvider(ctx context.Context, execPath string, args []string, logger *slog.Logger) (*ProcessSourceProvider, error) {
	cmd := exec.CommandContext(ctx, execPath, args...)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("create stdin pipe: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("create stdout pipe: %w", err)
	}

	// Capture stderr for debugging
	cmd.Stderr = &logWriter{logger: logger, name: execPath}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start process %s: %w", execPath, err)
	}

	p := &ProcessSourceProvider{
		cmd:    cmd,
		stdin:  stdin,
		stdout: bufio.NewReader(stdout),
		logger: logger,
		nextID: 1,
	}

	// Initialize: discover capabilities
	manifest, err := p.initialize(ctx)
	if err != nil {
		_ = p.Close()
		return nil, fmt.Errorf("initialize %s: %w", execPath, err)
	}
	p.manifest = manifest

	logger.Info("contrib source initialized",
		"name", manifest.Name,
		"version", manifest.Version,
		"stage", manifest.Stage,
		"capabilities", manifest.Capabilities,
		"languages", manifest.Languages,
	)

	return p, nil
}

func (p *ProcessSourceProvider) Manifest() repository.SourceManifest {
	return p.manifest
}

func (p *ProcessSourceProvider) Lookup(ctx context.Context, query repository.SourceQuery) (*repository.SourceResult, error) {
	params := buildLookupParams(query)

	var result LookupResult
	if err := p.call(ctx, "lookup", params, &result); err != nil {
		return nil, err
	}

	return convertLookupResult(&result, p.manifest.Name), nil
}

func (p *ProcessSourceProvider) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Send shutdown notification (best effort)
	req := Request{JSONRPC: "2.0", ID: 0, Method: "shutdown"}
	data, _ := json.Marshal(req)
	_, _ = p.stdin.Write(append(data, '\n'))

	_ = p.stdin.Close()

	done := make(chan error, 1)
	go func() { done <- p.cmd.Wait() }()

	select {
	case <-time.After(5 * time.Second):
		_ = p.cmd.Process.Kill()
		return fmt.Errorf("process did not exit gracefully, killed")
	case err := <-done:
		return err
	}
}

func (p *ProcessSourceProvider) initialize(ctx context.Context) (repository.SourceManifest, error) {
	var initResult InitializeResult
	if err := p.call(ctx, "initialize", nil, &initResult); err != nil {
		return repository.SourceManifest{}, err
	}
	return initResult.toSourceManifest(), nil
}

func (p *ProcessSourceProvider) call(ctx context.Context, method string, params any, result any) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	id := p.nextID
	p.nextID++

	req := Request{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}

	data, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	if _, err := p.stdin.Write(append(data, '\n')); err != nil {
		return fmt.Errorf("write request: %w", err)
	}

	// Read response line
	line, err := p.stdout.ReadBytes('\n')
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	var resp Response
	if err := json.Unmarshal(line, &resp); err != nil {
		return fmt.Errorf("unmarshal response: %w", err)
	}

	if resp.Error != nil {
		return resp.Error
	}

	if result != nil && resp.Result != nil {
		// Re-marshal and unmarshal to convert the result to the target type
		resultData, err := json.Marshal(resp.Result)
		if err != nil {
			return fmt.Errorf("marshal result: %w", err)
		}
		if err := json.Unmarshal(resultData, result); err != nil {
			return fmt.Errorf("unmarshal result into %T: %w", result, err)
		}
	}

	return nil
}

func buildLookupParams(query repository.SourceQuery) LookupParams {
	return LookupParams{
		Term:     query.Term,
		Language: query.Language,
	}
}

func convertLookupResult(lr *LookupResult, providerName string) *repository.SourceResult {
	if lr == nil {
		return nil
	}

	sr := &repository.SourceResult{}

	// Convert lexemes
	for _, lex := range lr.Lexemes {
		senses := make([]entity.LexemeSense, 0, len(lex.Senses))
		for _, s := range lex.Senses {
			senses = append(senses, entity.LexemeSense{
				Language: entity.ParseLanguage(s.Language),
				Gloss:    s.Gloss,
			})
		}
		sr.Lexemes = append(sr.Lexemes, &entity.Lexeme{
			ExternalID:   lex.ExternalID,
			Language:     entity.ParseLanguage(lex.Language),
			PartOfSpeech: entity.PartOfSpeech(lex.PartOfSpeech),
			EntryType:    entity.LexemeEntryType(lex.EntryType),
			SenseGloss:   lex.SenseGloss,
			Senses:       senses,
			Categories:   lex.Categories,
			Completeness: lex.Completeness,
		})
	}

	// Convert forms
	for _, f := range lr.Forms {
		sr.Forms = append(sr.Forms, convertResultForm(f))
	}

	// Convert relations
	for _, r := range lr.Relations {
		provider := r.Provider
		if provider == "" {
			provider = providerName
		}
		sr.Relations = append(sr.Relations, &entity.SemanticRelation{
			SourceExternalID: r.SourceExternalID,
			TargetRef:        r.TargetRef,
			TargetTerm:       r.TargetTerm,
			RelationType:     r.RelationType,
			Provider:         provider,
			Strength:         r.Strength,
			SenseMapped:      r.SenseMapped,
		})
	}

	// Convert lemma update
	if lr.LemmaUpdate != nil {
		lemma := &entity.Lemma{
			Level: lr.LemmaUpdate.Level,
		}
		for _, f := range lr.LemmaUpdate.Frequencies {
			lemma.Frequencies = append(lemma.Frequencies, entity.Frequency{
				Corpus: f.Corpus,
				Count:  f.Count,
			})
		}
		sr.LemmaUpdate = lemma
	}

	// Convert evidence
	if lr.Evidence != nil {
		provider := lr.Evidence.Provider
		if provider == "" {
			provider = providerName
		}
		sr.Evidence = []*entity.RawEvidence{{
			Provider:      provider,
			Phase:         lr.Evidence.Phase,
			Content:       lr.Evidence.Content,
			SchemaVersion: lr.Evidence.SchemaVersion,
			FetchedAt:     time.Now(),
		}}
	}

	// Convert forms by lexeme
	if len(lr.FormsByLexeme) > 0 {
		sr.FormsByLexeme = make(map[string][]*entity.LemmaForm)
		for lexID, forms := range lr.FormsByLexeme {
			for _, f := range forms {
				sr.FormsByLexeme[lexID] = append(sr.FormsByLexeme[lexID], convertResultForm(f))
			}
		}
	}

	return sr
}

func convertResultForm(f ResultForm) *entity.LemmaForm {
	phonetics := make([]entity.Phonetic, 0, len(f.Phonetics))
	for _, ph := range f.Phonetics {
		phonetics = append(phonetics, entity.Phonetic{
			IPA:     ph.IPA,
			Dialect: ph.Dialect,
		})
	}
	return &entity.LemmaForm{
		Surface:     f.Surface,
		FormType:    entity.FormType(f.FormType),
		IsIrregular: f.IsIrregular,
		Phonetics:   phonetics,
		Syllables:   f.Syllables,
	}
}

// logWriter sends external process stderr to slog.
type logWriter struct {
	logger *slog.Logger
	name   string
}

func (w *logWriter) Write(p []byte) (n int, err error) {
	msg := strings.TrimSpace(string(p))
	if msg != "" {
		w.logger.Debug("contrib stderr", "source", w.name, "msg", msg)
	}
	return len(p), nil
}
