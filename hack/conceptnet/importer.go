package main

import (
	"bufio"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/eslsoft/vocnet/hack/dictinit/pkg/report"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/store"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/util"
	entdb "github.com/eslsoft/vocnet/internal/infrastructure/database/ent"
	entconcept "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/concept"
	entconceptnetedge "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/conceptnetedge"
	entlexemeconceptlink "github.com/eslsoft/vocnet/internal/infrastructure/database/ent/lexemeconceptlink"
	"github.com/schollz/progressbar/v3"
)

type ImportConfig struct {
	FilePath  string
	Language  string
	MinWeight float64
	BatchSize int
}

type Importer struct {
	cfg              ImportConfig
	client           *entdb.Client
	surfaceToLexemes map[string][]store.SurfaceLexemeRef

	conceptCache    map[string]int64
	pendingConcepts map[string]*conceptRecord
	pendingEdges    []edgeRecord
}

type conceptRecord struct {
	ConceptnetID string
	Language     string
	Label        string
	Normalized   string
	Pos          string
	Sense        string
}

type edgeRecord struct {
	SourceConceptID string
	TargetConceptID string
	Relation        string
	Weight          float64
}

type conceptJSON struct {
	Weight float64 `json:"weight"`
}

func NewImporter(cfg ImportConfig, client *entdb.Client, surfaceToLexemes map[string][]store.SurfaceLexemeRef) *Importer {
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 256
	}
	return &Importer{
		cfg:              cfg,
		client:           client,
		surfaceToLexemes: surfaceToLexemes,
		conceptCache:     make(map[string]int64, 1024),
		pendingConcepts:  make(map[string]*conceptRecord, 1024),
		pendingEdges:     make([]edgeRecord, 0, cfg.BatchSize*4),
	}
}

func (i *Importer) Run(ctx context.Context) (*report.ImportReport, error) {
	rep := report.NewImportReport("ConceptNet")
	if i.client == nil {
		return rep, fmt.Errorf("conceptnet importer: missing ent client")
	}
	if i.cfg.FilePath == "" {
		return rep, fmt.Errorf("conceptnet importer: missing file path")
	}
	if i.cfg.Language == "" {
		i.cfg.Language = "en"
	}

	reader, closeFn, err := openMaybeGzip(i.cfg.FilePath)
	if err != nil {
		return rep, err
	}
	defer closeFn()

	log.Printf("[conceptnet] Importing from %s (lang=%s, min_weight=%.2f)", i.cfg.FilePath, i.cfg.Language, i.cfg.MinWeight)

	lineCount, err := countLines(i.cfg.FilePath)
	if err != nil {
		log.Printf("[conceptnet] Warning: failed to count lines: %v", err)
		lineCount = -1
	}

	bar := progressbar.NewOptions(lineCount,
		progressbar.OptionSetDescription("🌌 ConceptNet"),
		progressbar.OptionSetWidth(40),
		progressbar.OptionShowCount(),
		progressbar.OptionShowIts(),
		progressbar.OptionThrottle(200*time.Millisecond),
		progressbar.OptionClearOnFinish(),
	)

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 1024*1024), 16*1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		rep.Statistics.Total++
		if err := i.processLine(ctx, line, rep); err != nil {
			rep.Statistics.Failed++
			rep.AddParseError("", err.Error())
		}
		_ = bar.Add(1)
	}
	if err := scanner.Err(); err != nil {
		rep.AddParseError("", fmt.Sprintf("scan error: %v", err))
	}
	bar.Finish()

	if err := i.flushEdges(ctx, rep); err != nil {
		rep.AddAPIError("", fmt.Sprintf("flush edges: %v", err))
	}
	if err := i.flushConcepts(ctx, rep); err != nil {
		rep.AddAPIError("", fmt.Sprintf("flush concepts: %v", err))
	}

	rep.Finalize()
	if err := rep.SaveToFile("reports/conceptnet_import_report.json"); err != nil {
		log.Printf("[conceptnet] Warning: failed to save report: %v", err)
	}
	return rep, nil
}

func (i *Importer) processLine(ctx context.Context, line string, rep *report.ImportReport) error {
	parts := strings.Split(line, "\t")
	if len(parts) < 5 {
		rep.Statistics.Skipped++
		return fmt.Errorf("invalid assertion format")
	}

	relation := strings.TrimPrefix(strings.TrimSpace(parts[1]), "/r/")
	startURI := strings.TrimSpace(parts[2])
	endURI := strings.TrimSpace(parts[3])
	meta := strings.TrimSpace(parts[4])

	start, ok := parseConceptURI(startURI)
	if !ok || start.Language != i.cfg.Language {
		rep.Statistics.Skipped++
		return nil
	}
	end, ok := parseConceptURI(endURI)
	if !ok || end.Language != i.cfg.Language {
		rep.Statistics.Skipped++
		return nil
	}

	weight, ok := parseWeight(meta)
	if !ok || weight < i.cfg.MinWeight {
		rep.Statistics.Skipped++
		return nil
	}

	if err := i.ensureConcept(ctx, start, rep); err != nil {
		return err
	}
	if err := i.ensureConcept(ctx, end, rep); err != nil {
		return err
	}

	i.pendingEdges = append(i.pendingEdges, edgeRecord{
		SourceConceptID: start.ConceptnetID,
		TargetConceptID: end.ConceptnetID,
		Relation:        relation,
		Weight:          weight,
	})

	if len(i.pendingEdges) >= i.cfg.BatchSize*4 {
		if err := i.flushEdges(ctx, rep); err != nil {
			return err
		}
	}
	return nil
}

func (i *Importer) ensureConcept(ctx context.Context, concept conceptRecord, rep *report.ImportReport) error {
	if concept.ConceptnetID == "" {
		rep.Statistics.Skipped++
		return nil
	}
	if _, ok := i.conceptCache[concept.ConceptnetID]; ok {
		return nil
	}
	if _, ok := i.pendingConcepts[concept.ConceptnetID]; ok {
		return nil
	}
	i.pendingConcepts[concept.ConceptnetID] = &concept
	if len(i.pendingConcepts) >= i.cfg.BatchSize*4 {
		return i.flushConcepts(ctx, rep)
	}
	return nil
}

func (i *Importer) flushConcepts(ctx context.Context, rep *report.ImportReport) error {
	if len(i.pendingConcepts) == 0 {
		return nil
	}

	records := make([]*conceptRecord, 0, len(i.pendingConcepts))
	ids := make([]string, 0, len(i.pendingConcepts))
	creates := make([]*entdb.ConceptCreate, 0, len(i.pendingConcepts))

	for _, rec := range i.pendingConcepts {
		if rec == nil || rec.ConceptnetID == "" {
			continue
		}
		records = append(records, rec)
		ids = append(ids, rec.ConceptnetID)
		creates = append(creates, i.client.Concept.Create().
			SetConceptnetID(rec.ConceptnetID).
			SetLanguageCode(rec.Language).
			SetLabel(rec.Label).
			SetNormalized(rec.Normalized).
			SetPos(rec.Pos).
			SetSense(rec.Sense))
	}

	if len(creates) > 0 {
		if err := i.client.Concept.CreateBulk(creates...).
			OnConflictColumns(entconcept.FieldConceptnetID).
			DoNothing().
			Exec(ctx); err != nil {
			return fmt.Errorf("create concepts: %w", err)
		}
	}

	if len(ids) > 0 {
		concepts, err := i.client.Concept.Query().
			Where(entconcept.ConceptnetIDIn(ids...)).
			All(ctx)
		if err != nil {
			return fmt.Errorf("load concepts: %w", err)
		}
		for _, c := range concepts {
			if c == nil {
				continue
			}
			i.conceptCache[c.ConceptnetID] = c.ID
		}
		if err := i.createLexemeLinks(ctx, concepts); err != nil {
			return err
		}
	}

	i.pendingConcepts = make(map[string]*conceptRecord, 1024)
	return nil
}

func (i *Importer) createLexemeLinks(ctx context.Context, concepts []*entdb.Concept) error {
	if len(concepts) == 0 || len(i.surfaceToLexemes) == 0 {
		return nil
	}

	creates := make([]*entdb.LexemeConceptLinkCreate, 0, i.cfg.BatchSize*4)
	flush := func() error {
		if len(creates) == 0 {
			return nil
		}
		if err := i.client.LexemeConceptLink.CreateBulk(creates...).
			OnConflictColumns(entlexemeconceptlink.FieldLexemeID, entlexemeconceptlink.FieldConceptID).
			DoNothing().
			Exec(ctx); err != nil {
			return fmt.Errorf("create lexeme links: %w", err)
		}
		creates = creates[:0]
		return nil
	}

	for _, c := range concepts {
		if c == nil {
			continue
		}
		key := util.NormalizeKey(c.Label)
		if key == "" {
			continue
		}
		candidates := i.surfaceToLexemes[key]
		if len(candidates) == 0 {
			continue
		}
		for _, candidate := range candidates {
			if candidate.LexemeID == 0 {
				continue
			}
			creates = append(creates, i.client.LexemeConceptLink.Create().
				SetLexemeID(candidate.LexemeID).
				SetConceptID(c.ID).
				SetMatchType("lemma_normalized").
				SetConfidence(1.0))
			if len(creates) >= i.cfg.BatchSize*4 {
				if err := flush(); err != nil {
					return err
				}
			}
		}
	}

	return flush()
}

func (i *Importer) flushEdges(ctx context.Context, rep *report.ImportReport) error {
	if len(i.pendingEdges) == 0 {
		return nil
	}
	if err := i.flushConcepts(ctx, rep); err != nil {
		return err
	}

	creates := make([]*entdb.ConceptNetEdgeCreate, 0, len(i.pendingEdges))
	for _, edge := range i.pendingEdges {
		sourceID, ok := i.conceptCache[edge.SourceConceptID]
		if !ok || sourceID == 0 {
			rep.Statistics.Skipped++
			continue
		}
		targetID, ok := i.conceptCache[edge.TargetConceptID]
		if !ok || targetID == 0 {
			rep.Statistics.Skipped++
			continue
		}
		creates = append(creates, i.client.ConceptNetEdge.Create().
			SetSourceID(sourceID).
			SetTargetID(targetID).
			SetRelation(edge.Relation).
			SetWeight(edge.Weight))

		rep.Statistics.TotalRelations++
		rep.Statistics.RelationsByType[edge.Relation]++
	}

	if len(creates) > 0 {
		if err := i.client.ConceptNetEdge.CreateBulk(creates...).
			OnConflictColumns(entconceptnetedge.FieldRelation, entconceptnetedge.FieldSourceID, entconceptnetedge.FieldTargetID).
			DoNothing().
			Exec(ctx); err != nil {
			return fmt.Errorf("create edges: %w", err)
		}
		rep.Statistics.Successful += int64(len(creates))
	}

	i.pendingEdges = i.pendingEdges[:0]
	return nil
}

func parseConceptURI(uri string) (conceptRecord, bool) {
	if !strings.HasPrefix(uri, "/c/") {
		return conceptRecord{}, false
	}
	parts := strings.Split(uri, "/")
	if len(parts) < 4 {
		return conceptRecord{}, false
	}

	lang := parts[2]
	termRaw := parts[3]
	if lang == "" || termRaw == "" {
		return conceptRecord{}, false
	}

	decoded, err := url.PathUnescape(termRaw)
	if err != nil {
		decoded = termRaw
	}
	label := strings.ReplaceAll(decoded, "_", " ")
	normalized := util.NormalizeKey(label)

	rec := conceptRecord{
		ConceptnetID: uri,
		Language:     lang,
		Label:        label,
		Normalized:   normalized,
	}

	if len(parts) >= 5 && parts[4] != "" {
		rec.Pos = parts[4]
	}
	if len(parts) >= 6 {
		rec.Sense = strings.Join(parts[5:], "/")
	}

	return rec, true
}

func parseWeight(meta string) (float64, bool) {
	var data conceptJSON
	if err := json.Unmarshal([]byte(meta), &data); err != nil {
		return 0, false
	}
	return data.Weight, true
}

func openMaybeGzip(path string) (io.Reader, func(), error) {
	if path == "" {
		return nil, func() {}, fmt.Errorf("empty conceptnet file path")
	}
	expanded, err := util.ExpandHome(path)
	if err != nil {
		return nil, func() {}, err
	}
	file, err := os.Open(expanded)
	if err != nil {
		return nil, func() {}, fmt.Errorf("open conceptnet file: %w", err)
	}
	cleanup := func() { _ = file.Close() }
	if strings.EqualFold(filepath.Ext(expanded), ".gz") {
		gz, err := gzip.NewReader(file)
		if err != nil {
			_ = file.Close()
			return nil, func() {}, fmt.Errorf("gzip reader: %w", err)
		}
		return gz, func() {
			_ = gz.Close()
			_ = file.Close()
		}, nil
	}
	return file, cleanup, nil
}

func countLines(path string) (int, error) {
	reader, closeFn, err := openMaybeGzip(path)
	if err != nil {
		return 0, err
	}
	defer closeFn()

	buf := make([]byte, 1024*1024)
	count := 0
	for {
		n, readErr := reader.Read(buf)
		if n > 0 {
			for _, b := range buf[:n] {
				if b == '\n' {
					count++
				}
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return count, readErr
		}
	}
	return count, nil
}
