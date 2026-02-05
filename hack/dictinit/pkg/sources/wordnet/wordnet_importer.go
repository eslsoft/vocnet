package wordnet

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/eslsoft/vocnet/hack/dictinit/pkg/report"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/store"
	"github.com/eslsoft/vocnet/hack/dictinit/pkg/util"
	"github.com/eslsoft/vocnet/internal/entity"
	"github.com/schollz/progressbar/v3"
)

type Importer struct {
	wordnetDir string
	batchSize  int
	store      *store.LexemeImportService
}

func NewImporter(wordnetDir string, batchSize int, store *store.LexemeImportService) *Importer {
	return &Importer{
		wordnetDir: wordnetDir,
		batchSize:  batchSize,
		store:      store,
	}
}

func (i *Importer) Run(ctx context.Context) (*report.ImportReport, error) {
	rep := report.NewImportReport("WordNet")
	rep.Enrichment = &report.EnrichmentStats{}

	if i.wordnetDir == "" {
		return rep, fmt.Errorf("wordnet dir is required")
	}

	relIndex, stats, err := BuildRelationIndexFromDir(i.wordnetDir)
	if err != nil {
		return rep, err
	}
	if stats != nil && len(stats.Files) == 0 {
		log.Printf("[wordnet] no data.* files found in %s", i.wordnetDir)
		rep.Finalize()
		return rep, nil
	}

	knownForms, err := i.store.LoadKnownForms(ctx)
	if err != nil {
		return rep, fmt.Errorf("load known forms: %w", err)
	}

	surfaceToExtID, err := i.store.LoadExternalIDMap(ctx)
	if err != nil {
		return rep, fmt.Errorf("load external id map: %w", err)
	}

	keys := relIndex.Keys()
	filtered := make([]string, 0, len(keys))
	for _, key := range keys {
		if _, ok := knownForms[key]; ok {
			filtered = append(filtered, key)
		}
	}

	if len(filtered) == 0 {
		rep.Finalize()
		return rep, nil
	}

	rep.Statistics.Total = int64(len(filtered))
	rep.Enrichment.Attempted = int64(len(filtered))

	bar := progressbar.NewOptions(len(filtered),
		progressbar.OptionSetDescription("🔗 WordNet Relations"),
		progressbar.OptionSetWidth(40),
		progressbar.OptionShowCount(),
		progressbar.OptionShowIts(),
		progressbar.OptionThrottle(100*time.Millisecond),
	)

	jobCh := make(chan string, i.batchSize*2)
	progressCh := make(chan struct{}, i.batchSize*4)
	statsCh := make(chan workerStats, i.batchSize)
	var wg sync.WaitGroup

	progressDone := make(chan struct{})
	go func() {
		defer close(progressDone)
		for range progressCh {
			bar.Add(1)
		}
	}()

	for w := 0; w < i.batchSize; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			stats := newWorkerStats()
			for key := range jobCh {
				res := i.enrichWord(ctx, key, relIndex.Get(key), surfaceToExtID)
				stats.applyResult(res)
				progressCh <- struct{}{}
			}
			statsCh <- stats
		}()
	}

	go func() {
		defer close(jobCh)
		for _, key := range filtered {
			jobCh <- key
		}
	}()

	wg.Wait()
	close(progressCh)
	<-progressDone
	close(statsCh)
	bar.Finish()

	finalStats := newWorkerStats()
	for s := range statsCh {
		finalStats.merge(s)
	}

	rep.Statistics.Successful = finalStats.succeeded
	rep.Statistics.Failed = finalStats.failed
	rep.Statistics.Skipped = finalStats.skipped
	rep.Enrichment.Succeeded = finalStats.succeeded
	rep.Enrichment.Failed = finalStats.failed
	rep.Enrichment.NotFound = finalStats.notFound
	rep.Statistics.TotalRelations = finalStats.relationsAdded
	rep.Statistics.RelationsByType = make(map[string]int64)
	for relType, count := range finalStats.relationTypes {
		rep.Statistics.RelationsByType[fmt.Sprintf("%d", relType)] = count
	}

	rep.Finalize()

	reportPath := "reports/wordnet_import_report.json"
	if err := rep.SaveToFile(reportPath); err != nil {
		log.Printf("[wordnet] Warning: failed to save report to %s: %v", reportPath, err)
	} else {
		log.Printf("[wordnet] Report saved to %s", reportPath)
	}

	return rep, nil
}

type enrichResult struct {
	term           string
	succeeded      bool
	failed         bool
	notFound       bool
	skipped        bool
	relationsAdded int64
	relationTypes  map[int32]int64
	err            error
}

func (i *Importer) enrichWord(ctx context.Context, key string, relations []RelationCandidate, surfaceToExtID map[string][]store.SurfaceLexemeRef) enrichResult {
	res := enrichResult{
		term:          key,
		relationTypes: make(map[int32]int64),
	}
	if len(relations) == 0 {
		res.skipped = true
		return res
	}

	lexemes, err := i.store.FindAllLexemesByLemmaSurface(ctx, key, "en")
	if err != nil {
		res.err = err
		res.failed = true
		return res
	}
	if len(lexemes) == 0 {
		res.notFound = true
		return res
	}

	var hadChange bool
	var hadError bool
	for _, lexData := range lexemes {
		added, changed := i.applyRelations(lexData, relations, surfaceToExtID)
		if !changed {
			continue
		}
		if err := i.store.CreateOrUpdateComplete(ctx, lexData); err != nil {
			res.err = err
			hadError = true
			continue
		}
		hadChange = true
		for relType, count := range added {
			res.relationTypes[relType] += count
			res.relationsAdded += count
		}
	}

	if hadChange {
		res.succeeded = true
		return res
	}
	if hadError {
		res.failed = true
		return res
	}

	res.skipped = true
	return res
}

type addedRelations map[int32]int64

func (i *Importer) applyRelations(data *store.ImportLexemeData, relations []RelationCandidate, surfaceToExtID map[string][]store.SurfaceLexemeRef) (added addedRelations, changed bool) {
	if data == nil || data.Lexeme == nil {
		return nil, false
	}

	lex := data.Lexeme
	added = make(addedRelations)

	for _, rel := range relations {
		if rel.SourcePOS != "" && lex.PartOfSpeech != "" && rel.SourcePOS != lex.PartOfSpeech {
			continue
		}

		targetKey := util.NormalizeKey(rel.TargetTerm)
		candidates, ok := surfaceToExtID[targetKey]
		if !ok || len(candidates) == 0 {
			continue
		}

		targetExtID, ok := pickTarget(candidates, rel.TargetPOS, lex.ExternalID)
		if !ok || targetExtID == "" {
			continue
		}

		if relationExists(lex.Relations, targetExtID, rel.RelationType) {
			continue
		}

		lex.Relations = append(lex.Relations, entity.LexemeRelation{
			LexemeID:       lex.ExternalID,
			TargetLexemeID: targetExtID,
			RelationType:   rel.RelationType,
		})
		added[rel.RelationType]++
		changed = true
	}

	return added, changed
}

func pickTarget(candidates []store.SurfaceLexemeRef, desiredPOS, currentExtID string) (string, bool) {
	if desiredPOS != "" {
		for _, c := range candidates {
			if c.ExternalID == "" || c.ExternalID == currentExtID {
				continue
			}
			if c.Pos == desiredPOS {
				return c.ExternalID, true
			}
		}
	}

	for _, c := range candidates {
		if c.ExternalID == "" || c.ExternalID == currentExtID {
			continue
		}
		return c.ExternalID, true
	}

	return "", false
}

func relationExists(relations []entity.LexemeRelation, targetExtID string, relType int32) bool {
	for _, r := range relations {
		if r.TargetLexemeID == targetExtID && r.RelationType == relType {
			return true
		}
	}
	return false
}

type workerStats struct {
	succeeded      int64
	failed         int64
	skipped        int64
	notFound       int64
	relationsAdded int64
	relationTypes  map[int32]int64
}

func newWorkerStats() workerStats {
	return workerStats{
		relationTypes: make(map[int32]int64),
	}
}

func (s *workerStats) applyResult(res enrichResult) {
	if res.succeeded {
		s.succeeded++
	}
	if res.failed {
		s.failed++
	}
	if res.skipped {
		s.skipped++
	}
	if res.notFound {
		s.notFound++
	}
	if res.relationsAdded > 0 {
		s.relationsAdded += res.relationsAdded
	}
	for relType, count := range res.relationTypes {
		s.relationTypes[relType] += count
	}
}

func (s *workerStats) merge(other workerStats) {
	s.succeeded += other.succeeded
	s.failed += other.failed
	s.skipped += other.skipped
	s.notFound += other.notFound
	s.relationsAdded += other.relationsAdded
	if s.relationTypes == nil {
		s.relationTypes = make(map[int32]int64)
	}
	for relType, count := range other.relationTypes {
		s.relationTypes[relType] += count
	}
}
