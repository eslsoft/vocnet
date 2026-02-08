package pipeline

import (
	"fmt"

	"github.com/eslsoft/vocnet/internal/entity"
)

// DataAggregator handles merging of lexeme data from multiple sources.
// This centralizes all duplicate detection and merging logic.
type DataAggregator struct{}

func NewDataAggregator() *DataAggregator {
	return &DataAggregator{}
}

// MergeSenses combines two sense lists, avoiding duplicates by language+gloss.
func (a *DataAggregator) MergeSenses(existing, new []entity.LexemeSense) []entity.LexemeSense {
	seen := make(map[string]struct{})
	result := make([]entity.LexemeSense, 0, len(existing)+len(new))

	for _, sense := range existing {
		key := fmt.Sprintf("%s:%s", sense.Language.Code(), sense.Gloss)
		if _, ok := seen[key]; !ok {
			result = append(result, sense)
			seen[key] = struct{}{}
		}
	}

	for _, sense := range new {
		key := fmt.Sprintf("%s:%s", sense.Language.Code(), sense.Gloss)
		if _, ok := seen[key]; !ok {
			result = append(result, sense)
			seen[key] = struct{}{}
		}
	}

	return result
}

// MergeFrequencies combines frequency lists, overwriting duplicates by corpus.
func (a *DataAggregator) MergeFrequencies(existing, new []entity.Frequency) []entity.Frequency {
	seen := make(map[string]int64)
	result := make([]entity.Frequency, 0, len(existing)+len(new))

	// Add existing frequencies
	for _, freq := range existing {
		if freq.Corpus != "" {
			seen[freq.Corpus] = freq.Count
			result = append(result, freq)
		}
	}

	// Add new frequencies (overwrite if corpus already exists)
	for _, freq := range new {
		if freq.Corpus != "" {
			if _, ok := seen[freq.Corpus]; ok {
				// Update existing entry
				for i := range result {
					if result[i].Corpus == freq.Corpus {
						result[i].Count = freq.Count
						break
					}
				}
			} else {
				// Add new entry
				result = append(result, freq)
				seen[freq.Corpus] = freq.Count
			}
		}
	}

	return result
}

// MergeCategories combines category lists, avoiding duplicates.
func (a *DataAggregator) MergeCategories(existing, new []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(existing)+len(new))

	for _, cat := range existing {
		if cat != "" && !seen[cat] {
			result = append(result, cat)
			seen[cat] = true
		}
	}

	for _, cat := range new {
		if cat != "" && !seen[cat] {
			result = append(result, cat)
			seen[cat] = true
		}
	}

	return result
}

// MergePhonetics combines phonetic lists, avoiding duplicates by IPA+Dialect.
func (a *DataAggregator) MergePhonetics(existing, new []entity.Phonetic) []entity.Phonetic {
	seen := make(map[string]struct{})
	result := make([]entity.Phonetic, 0, len(existing)+len(new))

	for _, p := range existing {
		key := fmt.Sprintf("%s:%s", p.IPA, p.Dialect)
		if _, ok := seen[key]; !ok {
			result = append(result, p)
			seen[key] = struct{}{}
		}
	}

	for _, p := range new {
		key := fmt.Sprintf("%s:%s", p.IPA, p.Dialect)
		if _, ok := seen[key]; !ok {
			result = append(result, p)
			seen[key] = struct{}{}
		}
	}

	return result
}

// MergeForms combines form lists, avoiding duplicates by surface+formType.
func (a *DataAggregator) MergeForms(existing, new []*entity.LemmaForm) []*entity.LemmaForm {
	existingMap := make(map[string]*entity.LemmaForm)
	for _, f := range existing {
		key := fmt.Sprintf("%s:%s", f.Surface, f.FormType)
		existingMap[key] = f
	}

	formsToAdd := make([]*entity.LemmaForm, 0)
	formsToUpdate := make([]*entity.LemmaForm, 0)

	for _, newForm := range new {
		key := fmt.Sprintf("%s:%s", newForm.Surface, newForm.FormType)
		existingForm, exists := existingMap[key]

		if !exists {
			formsToAdd = append(formsToAdd, newForm)
		} else if len(newForm.Phonetics) > 0 {
			// Merge phonetics if new ones are provided
			merged := a.MergePhonetics(existingForm.Phonetics, newForm.Phonetics)
			if len(merged) > len(existingForm.Phonetics) {
				updatedForm := *existingForm
				updatedForm.Phonetics = merged
				formsToUpdate = append(formsToUpdate, &updatedForm)
			}
		}
	}

	return append(formsToAdd, formsToUpdate...)
}

// EnrichLexeme updates an existing lexeme with new data, applying smart merging.
func (a *DataAggregator) EnrichLexeme(existing *entity.Lexeme, new *entity.Lexeme) *entity.Lexeme {
	enriched := *existing

	// Update ExternalID if the new one is from Wikidata (starts with 'L')
	if new.ExternalID != "" && len(new.ExternalID) > 0 && new.ExternalID[0] == 'L' {
		enriched.ExternalID = new.ExternalID
	}

	// Merge senses
	if len(new.Senses) > 0 {
		enriched.Senses = a.MergeSenses(existing.Senses, new.Senses)
	}

	// Merge frequencies
	if len(new.Frequencies) > 0 {
		enriched.Frequencies = a.MergeFrequencies(existing.Frequencies, new.Frequencies)
	}

	// Merge categories
	if len(new.Categories) > 0 {
		enriched.Categories = a.MergeCategories(existing.Categories, new.Categories)
	}

	// Update scalar fields if empty or new value is better
	if enriched.PartOfSpeech == "" && new.PartOfSpeech != "" {
		enriched.PartOfSpeech = new.PartOfSpeech
	}
	if enriched.SenseGloss == "" && new.SenseGloss != "" {
		enriched.SenseGloss = new.SenseGloss
	}
	if new.Completeness > 0 {
		enriched.Completeness = new.Completeness
	}

	return &enriched
}
