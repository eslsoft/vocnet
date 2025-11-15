# Word Entity Refactor Specification

## Problems

1. **Incorrect query response**: Query "books" returns `{term:"book", termType:LEMMA}`, should return `{term:"books", termType:PLURAL, lemma:"book"}`
2. **Entity naming confusion**: `entity.Word` is actually a Lemma aggregation
3. **Phonetics location**: Phonetics in `words` table should be in `lexeme_forms` (different forms have different pronunciations, e.g., read /riːd/ vs read /red/)

## Goals

1. Rename `Word` → `Lemma`
2. Add `WordEntry` business entity (carries query context)
3. Move phonetics from Lemma to Form
4. Fix query logic
5. Keep proto unchanged

## Data Model

```
Lemma (词元 - words table)
  ├─ Lexeme 1 (词位 - noun)
  │   ├─ Form: book (LEMMA) [phonetics: "bʊk"]
  │   ├─ Form: books (PLURAL) [phonetics: "bʊks"]
  │   └─ Senses: {...}
  └─ Lexeme 2 (词位 - verb)
      ├─ Form: book (LEMMA) [phonetics: "bʊk"]
      ├─ Form: books (3SG)
      ├─ Form: booked (PAST)
      └─ Form: booking (PARTICIPLE)
```

## Entity Definitions

### 1. Lemma (storage entity, maps to words table)

```go
type Lemma struct {
    ID           int64
    WID          string      // {language}:{lemma}
    Text         string      // lemma text
    Language     Language
    Categories   []string
    Lexemes      []*Lexeme
    // Remove Phonetics
    
    Completeness int32
    CreatedAt    time.Time
    UpdatedAt    time.Time
}
```

### 2. LexemeForm (storage entity, maps to lexeme_forms table)

```go
type LexemeForm struct {
    ID          int64
    LexemeID    int64
    Text        string
    FormType    LexemeFormType
    IsIrregular bool
    Phonetics   []Phonetic  // ADD THIS
    
    CreatedAt time.Time
    UpdatedAt time.Time
}
```

### 3. WordEntry (business entity, no table mapping)

```go
type WordEntry struct {
    QueriedTerm     string        // User's input
    Lemma           *Lemma
    QueriedFormType LexemeFormType
    IsIrregular     bool
}

func (w *WordEntry) IsQueriedLemma() bool
func (w *WordEntry) GetAllForms() []LexemeForm
func (w *WordEntry) FindQueriedForm() *LexemeForm
```

## API Response Modes

### Mode A: Lemma View (query lemma)

Query: "book"
```json
{
  "term": "book",
  "termType": "LEMMA",
  "lemma": null,
  "phonetics": [{"ipa": "bʊk"}],
  "relatedForms": [
    {"term": "books", "formType": "PLURAL"},
    {"term": "booked", "formType": "PAST"}
  ]
}
```

### Mode B: Form View (query inflection)

Query: "books"
```json
{
  "term": "books",
  "termType": "PLURAL",
  "lemma": "book",
  "phonetics": [{"ipa": "bʊks"}],
  "relatedForms": []
}
```

## Implementation Steps

### Step 1: Database Schema

```sql
-- Add phonetics to lexeme_forms
ALTER TABLE lexeme_forms 
ADD COLUMN phonetics JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Remove phonetics from words (after data population)
ALTER TABLE words DROP COLUMN phonetics;
```

### Step 2: Ent Schema Updates

```go
// entschema/word.go
func (Word) Fields() []ent.Field {
    return []ent.Field{
        field.String("wid").Unique(),
        field.String("lemma").NotEmpty(),
        field.String("language").Default("en"),
        field.JSON("categories", []string{}).Optional(),
        field.Int32("completeness").Default(0),
        // REMOVE: field.JSON("phonetics", []Phonetic{})
    }
}

// entschema/lexeme_form.go
func (LexemeForm) Fields() []ent.Field {
    return []ent.Field{
        field.String("text").NotEmpty(),
        field.String("form_type").Default(""),
        field.Bool("is_irregular").Default(false),
        field.JSON("phonetics", []Phonetic{}).Optional(),  // ADD THIS
    }
}
```

Then run: `make ent-generate`

### Step 3: Entity Layer

**File rename**: `internal/entity/word.go` → `internal/entity/lemma.go`

**Type rename**:
```go
// OLD: type Word struct { Lemma string; ... }
// NEW:
type Lemma struct {
    ID         int64
    WID        string
    Text       string  // renamed from Lemma
    Language   Language
    Categories []string
    Lexemes    []*Lexeme
    // REMOVE Phonetics
    
    Completeness int32
    CreatedAt    time.Time
    UpdatedAt    time.Time
}
```

**Update LexemeForm**:
```go
type LexemeForm struct {
    ID          int64
    LexemeID    int64
    Text        string
    FormType    LexemeFormType
    IsIrregular bool
    Phonetics   []Phonetic  // ADD
    CreatedAt   time.Time
    UpdatedAt   time.Time
}
```

**Add WordEntry**:
```go
type WordEntry struct {
    QueriedTerm     string
    Lemma           *Lemma
    QueriedFormType LexemeFormType
    IsIrregular     bool
}

func (w *WordEntry) IsQueriedLemma() bool {
    return strings.EqualFold(w.QueriedTerm, w.Lemma.Text)
}

func (w *WordEntry) GetAllForms() []LexemeForm {
    var forms []LexemeForm
    for _, lex := range w.Lemma.Lexemes {
        forms = append(forms, lex.Forms...)
    }
    return forms
}

func (w *WordEntry) FindQueriedForm() *LexemeForm {
    for _, lex := range w.Lemma.Lexemes {
        for i, form := range lex.Forms {
            if strings.EqualFold(form.Text, w.QueriedTerm) {
                return &lex.Forms[i]
            }
        }
    }
    return nil
}
```

### Step 4: Repository Layer

**Rename**: `WordGroupRepository` → `LemmaRepository`

```go
type LemmaRepository interface {
    GetByID(ctx context.Context, id int64) (*Lemma, error)
    GetByWID(ctx context.Context, wid string) (*Lemma, error)
    List(ctx context.Context, query *ListLemmaQuery) ([]*Lemma, int64, error)
    Create(ctx context.Context, lemma *Lemma) (*Lemma, error)
    Update(ctx context.Context, lemma *Lemma) (*Lemma, error)
    Delete(ctx context.Context, id int64) error
    ListCategories(ctx context.Context, search string) ([]string, error)
    Stats(ctx context.Context, filter *LemmaStats) (*LemmaStats, error)
}
```

**Update mapping**:
```go
func mapEntLemma(rec *entdb.Word) *entity.Lemma {
    return &entity.Lemma{
        ID:         rec.ID,
        WID:        rec.Wid,
        Text:       rec.Lemma,
        Language:   entity.ParseLanguage(rec.Language),
        Categories: rec.Categories,
        // NO Phonetics
    }
}

func mapEntLexemeForm(rec *entdb.LexemeForm) entity.LexemeForm {
    return entity.LexemeForm{
        ID:          rec.ID,
        LexemeID:    rec.LexemeID,
        Text:        rec.Text,
        FormType:    entity.LexemeFormType(rec.FormType),
        IsIrregular: rec.IsIrregular,
        Phonetics:   rec.Phonetics,  // ADD
        CreatedAt:   rec.CreatedAt,
        UpdatedAt:   rec.UpdatedAt,
    }
}
```

### Step 5: UseCase Layer

**Update interface**:
```go
type WordUsecase interface {
    Lookup(ctx, surface, language) (*WordEntry, error)
    List(ctx, filter) ([]*WordEntry, int64, error)
    
    GetLemma(ctx, id) (*Lemma, error)
    CreateLemma(ctx, lemma) (*Lemma, error)
    UpdateLemma(ctx, lemma) (*Lemma, error)
    DeleteLemma(ctx, id) error
    
    ListCategories(ctx, search) ([]string, error)
    Stats(ctx, filter) (*WordStats, error)
}
```

**Lookup logic**:
```go
func (u *wordUsecase) Lookup(ctx context.Context, surface string, language entity.Language) (*WordEntry, error) {
    surface = strings.TrimSpace(surface)
    if surface == "" {
        return nil, entity.ErrInvalidLexemeText
    }
    
    // Try lemma lookup
    wid := makeWID(language, surface)
    lemma, err := u.lemmaRepo.GetByWID(ctx, wid)
    if err == nil {
        return u.buildWordEntry(ctx, lemma, surface)
    }
    
    // Try form lookup
    lexeme, err := u.lexemeRepo.Lookup(ctx, surface, language)
    if err != nil || lexeme == nil {
        return nil, err
    }
    
    if lexeme.LemmaID == 0 {
        return nil, nil
    }
    
    lemma, err = u.lemmaRepo.GetByID(ctx, lexeme.LemmaID)
    if err != nil {
        return nil, err
    }
    
    return u.buildWordEntry(ctx, lemma, surface)
}

func (u *wordUsecase) buildWordEntry(ctx context.Context, lemma *Lemma, queriedTerm string) (*WordEntry, error) {
    // Load all lexemes with forms
    lexemes, err := u.lexemeRepo.ListByLemmaID(ctx, lemma.ID)
    if err != nil {
        return nil, err
    }
    
    lemma.Lexemes = lexemes
    
    entry := &WordEntry{
        QueriedTerm: queriedTerm,
        Lemma:       lemma,
    }
    
    // Find matching form
    if form := entry.FindQueriedForm(); form != nil {
        entry.QueriedFormType = form.FormType
        entry.IsIrregular = form.IsIrregular
    } else {
        entry.QueriedFormType = entity.LexemeFormTypeLemma
        entry.IsIrregular = false
    }
    
    return entry, nil
}
```

**List logic (surface filter)**:
```go
func (u *wordUsecase) List(ctx context.Context, filter *ListWordQuery) ([]*WordEntry, int64, error) {
    if len(filter.SurfaceTerms) == 0 {
        // Normal query, group by lemma
        lemmas, total, err := u.lemmaRepo.List(ctx, filter)
        if err != nil {
            return nil, 0, err
        }
        
        entries := make([]*WordEntry, 0, len(lemmas))
        for _, lemma := range lemmas {
            entry, err := u.buildWordEntry(ctx, lemma, lemma.Text)
            if err != nil {
                continue
            }
            entries = append(entries, entry)
        }
        return entries, total, nil
    }
    
    // Surface batch query - return separate WordEntry for each term
    results := make([]*WordEntry, 0, len(filter.SurfaceTerms))
    for _, surface := range filter.SurfaceTerms {
        entry, err := u.Lookup(ctx, surface, filter.Language)
        if err == nil && entry != nil {
            results = append(results, entry)
        }
    }
    
    return results, int64(len(results)), nil
}
```

### Step 6: Mapping Layer

```go
func ToPbWord(entry *entity.WordEntry) *dictv1.Word {
    if entry.IsQueriedLemma() {
        return buildLemmaView(entry)
    }
    return buildFormView(entry)
}

func buildLemmaView(entry *entity.WordEntry) *dictv1.Word {
    allForms := entry.GetAllForms()
    var lemmaPhonetics []entity.Phonetic
    
    // Find lemma form's phonetics
    for _, form := range allForms {
        if form.FormType == entity.LexemeFormTypeLemma {
            lemmaPhonetics = form.Phonetics
            break
        }
    }
    
    return &dictv1.Word{
        Id:           entry.Lemma.ID,
        Term:         entry.Lemma.Text,
        TermType:     dictv1.FormType_FORM_TYPE_LEMMA,
        Lemma:        nil,
        Language:     ToPbLanguage(entry.Lemma.Language),
        Phonetics:    mapPhonetics(lemmaPhonetics),
        Meanings:     aggregateMeanings(entry.Lemma.Lexemes),
        RelatedForms: buildRelatedForms(allForms, true), // exclude lemma
        Categories:   entry.Lemma.Categories,
        Irregular:    false,
        Completeness: entry.Lemma.Completeness,
    }
}

func buildFormView(entry *entity.WordEntry) *dictv1.Word {
    queriedForm := entry.FindQueriedForm()
    var phonetics []entity.Phonetic
    if queriedForm != nil {
        phonetics = queriedForm.Phonetics
    }
    
    lemmaText := entry.Lemma.Text
    return &dictv1.Word{
        Id:           entry.Lemma.ID,
        Term:         entry.QueriedTerm,
        TermType:     toPbFormType(entry.QueriedFormType),
        Lemma:        &lemmaText,
        Language:     ToPbLanguage(entry.Lemma.Language),
        Phonetics:    mapPhonetics(phonetics),
        Meanings:     aggregateMeanings(entry.Lemma.Lexemes),
        RelatedForms: nil, // empty for form view
        Categories:   entry.Lemma.Categories,
        Irregular:    entry.IsIrregular,
        Completeness: entry.Lemma.Completeness,
    }
}

func buildRelatedForms(allForms []entity.LexemeForm, excludeLemma bool) []*dictv1.RelatedForm {
    seen := make(map[string]bool)
    var forms []*dictv1.RelatedForm
    
    for _, form := range allForms {
        if excludeLemma && form.FormType == entity.LexemeFormTypeLemma {
            continue
        }
        
        key := strings.ToLower(form.Text)
        if seen[key] {
            continue
        }
        seen[key] = true
        
        forms = append(forms, &dictv1.RelatedForm{
            Term:      form.Text,
            FormType:  toPbFormType(form.FormType),
            Irregular: form.IsIrregular,
        })
    }
    
    return forms
}
```

### Step 7: Rename References

**Files to update**:
- `internal/repository/*.go`: Word → Lemma
- `internal/usecase/*.go`: Return WordEntry
- `internal/adapter/connectrpc/*.go`: Use WordEntry
- `internal/mocks/*.go`: Regenerate
- Test files

**Type renames**:
```
entity.Word              → entity.Lemma
WordGroupRepository      → LemmaRepository
wordGroupRepository      → lemmaRepository
mapEntWord              → mapEntLemma
```

### Step 8: Testing

**Unit tests**:
```go
TestLookup_Lemma:
    input: "book"
    expect: {term:"book", termType:LEMMA, lemma:null, relatedForms:[...]}

TestLookup_Form:
    input: "books"
    expect: {term:"books", termType:PLURAL, lemma:"book", relatedForms:[]}

TestLookup_Irregular:
    input: "went"
    expect: {term:"went", termType:PAST, lemma:"go", irregular:true}

TestList_Surface:
    input: surface=["book","books"]
    expect: 2 WordEntry objects with different terms
```

## Key Points

1. **Lexeme.LemmaID**: Rename from `word_id` in code (DB field name stays same for now)
2. **Phonetics**: Always read from Form, never from Lemma
3. **Surface filter**: Must return duplicate entries for same lemma but different query terms
4. **Proto compatibility**: No changes to proto definitions
5. **Data reload**: Database will be cleared and reimported, no migration needed

## Execution Order

1. Update DB schema (add phonetics to lexeme_forms)
2. Update Ent schemas → regenerate
3. Rename entity.Word → entity.Lemma
4. Add entity.WordEntry
5. Update Repository layer
6. Update UseCase layer (Lookup + List)
7. Update Mapping layer
8. Fix all compilation errors
9. Run tests
10. Reimport data with phonetics on forms
