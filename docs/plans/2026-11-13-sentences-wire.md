# Wire changes for sentences and typed phrases (2026-11-13)

Companion to `2026-11-13-sentences-and-phrases.md` (the plan, in Chinese, confirmed). This is the
contract the server implements and the producer adapts to. The authoritative schemas stay
`shared/*.ts` and `GET /manage/openapi.json` once they ship. Wire field names are snake_case.

## 1. Sentence node

New table `sentences`, a node like `entries`:

| column | |
|---|---|
| `id` | text pk (uuid) |
| `text` | the sentence as first submitted |
| `text_key` | `textKey(text)` (server/domain/term.ts), unique |
| `source` | free text, nullable; null means made up by a producer. Imports may set a book or film title. |
| `created_by`, `created_at` | |

- Nodes carry identity only. `source` is provenance, not a reviewed claim.
- Workers never create sentences directly. A submission that names a sentence by `text` resolves it
  by `text_key`: the existing row, or a new one created in the same write. The stored payload holds
  the id.
- What a sentence *is* is derived on read: a **saying** when a published `phrases` list lists it
  with type `saying`; an **example** when a published `example` fact links it to a sense. It may be
  both. Nothing stores the type.
- New subject type `sentence` (`SubjectTypeOf`).

## 2. Fact kinds

| kind | change |
|---|---|
| `example` | subject sense, object the sentence. Stored payload `{ sentence_id }`. Submit accepts `{ sentence_id }` or `{ text }` (resolved). `object_id` = sentence id, content key = sentence id. A sentence may be an example of many senses, of many entries. Review is the current example rubric, asked of the sentence text under this sense. |
| `translation` | `of: "sense" \| "sentence" \| "collocation"`; `"example"` is removed. Subject: the sense, the sentence, or the collocation fact. One per subject and language, as now. |
| `sentence_meaning` (new) | subject sentence, cardinality one. Payload `{ gloss }`: an English gloss of what the saying means and when it is said. Required only for sayings. Review: Jev → LLM, rubric: states the saying's actual (not literal) meaning and use; dictionary style; no quotation of the saying itself as the gloss. |
| `phrases` | items become objects, see §3. |
| `collocation` | `pattern` gains `subject_verb` ("the room spins"), `verb_adjective` ("go bankrupt", "squash flat"), `passive` ("tormented by guilt"). The rubric explains each, including that a particle after a verb is `verb_adverb` ("tack down") and a verb + preposition + noun is `verb_preposition` ("return to one's birthplace"). Published collocations are untouched. |

## 3. Typed phrases list

Stored payload:

```json
{ "phrases": [
  { "type": "fixed_phrase", "entry_id": "…" },
  { "type": "compound",     "entry_id": "…", "sense_id": "…" },
  { "type": "phrasal_verb", "entry_id": "…" },
  { "type": "idiom",        "entry_id": "…" },
  { "type": "saying",       "sentence_id": "…" }
] }
```

- `type`: `phrasal_verb | compound | idiom | fixed_phrase | saying`.
- `saying` names a `sentence_id`; every other type names an `entry_id`.
- `sense_id` is optional: a sense of the headword's current inventory that the phrase plainly
  belongs to (a compound or set phrase built on that sense). Idioms, phrasal verbs, and phrases tied
  to no sense omit it.
- Submit accepts each item as `{ type, text, sense_id? }` or with the id. `text` resolves to an entry
  by exact lemma, creating it **not live** if missing (non-saying types), or to a sentence (saying).
  Write rules: a non-saying item is a multiword lemma containing the headword (as now); a saying is a
  complete sentence; each target once; `sense_id` must be a sense of the headword (`422`).
- Content key: the sorted `type:id[:sense_id]` of the items.
- Still one list per headword, generated in one pass, reviewed as one fact: Jev per item (the
  question now names the type and, when given, the sense) then the LLM rubric, which adds:
  - the type is right; a complete sentence (proverb, maxim, saying) must be `saying` and is never a
    phrase entry;
  - a given `sense_id` is a sense the phrase plainly belongs to; a missing `sense_id` is never a
    failure.
- Publishing admits the entry items (live, the headword's batch) as now. Saying items admit nothing;
  their sentences get translation and meaning work on the headword (§4). An entry no published list
  names as an entry item stops being live (existing `setPhrasesLive`).
- A phrase entry's **phrase type** is derived on read: the type the earliest published list naming
  it gives.

## 4. Work (gaps) changes

Per entry, as now (work items stay keyed by entry):

- **translations** gap `missing` items are `{ of: "sense" | "sentence" | "collocation", id }`.
  Sentences counted: those of the entry's examples (its counted senses), and on a headword the
  sayings of its published phrases list. A sentence shared by several entries is one translation;
  whichever entry's pass fills it, it is filled for all.
- **sayings** (new type, entry, stage 3, context `entry`): the headword's published list has sayings
  without a live `sentence_meaning`. Gap `{ type: "sayings", missing: [sentence_id] }`.
- **Multiword entries** (by phrase type):

  | slot | phrasal_verb | compound | idiom | fixed_phrase |
  |---|---|---|---|---|
  | senses, examples, translations, synonyms | ✓ | ✓ | ✓ | ✓ |
  | category, topics | – | ✓ | – | – |
  | pronunciation, collocations | – | – | – | – |
  | forms, syllables, morphology, phrases, family | – (as now) | – | – | – |
  | grammar | paused (as now) | | | |

  Facts already published for slots no longer required stay; they no longer count.
- **synonyms** slot (single words and phrases): also filled when the sense has a live hypernym to a
  visible sense. Producers still submit every real synonym and antonym.
- Sense-inventory review (`SENSE_LIST_FAILS` / `NEVER_FAILS`):
  - part of speech is the grammatical function; never fail an idiom or fixed phrase for not being
    labelled "idiom", "phrase", or "saying";
  - an entry whose every sense is technical, specialist, or regional ranks its main sense common;
    never fail that sense as misplaced.

## 5. Catalog

- `POST /manage/v1/entries/{id}/retire` (curators): takes an admitted entry off the wordlist
  (`live = false`, revision bump, linked work touched). `409` when a published phrases list names it
  as an entry item. `POST /manage/v1/entries` admits it again.
- Headword import filters before admitting (`importCoreEntries` and any batch import): skips single
  letters, contractions and clitics (`'s`, `'m`, `'re`), lemmas with characters outside letters,
  space, hyphen, apostrophe; reduces a regular inflection (`-s/-es/-ies`, `-ed/-ied`, `-ing`,
  `-er/-est`) to its base when the base is a candidate or an entry and the reference CEFR list does
  not list the form itself; merges British/American spelling pairs (`-our/-or`, `-ise/-ize`,
  `-yse/-yze`, `-re/-er`, `-ogue/-og`) into the first, recording the other as a `variant` form when
  the entry is created. The response reports what each rule skipped.

## 6. Public API

- Sense `examples[]`: `{ sentence_id, text, translations }` (adds `sentence_id`).
- Headword `phrases` becomes grouped:
  `{ by_sense: [{ sense_id, phrases: [summary] }], phrasal_verbs: [summary], idioms: [summary]`
  (idiom and fixed_phrase), `compounds: [summary], sayings: [{ sentence_id, text, meaning, translations }] }`.
- Phrase entry document gains `phrase_type` (null for single words).
- `GET /v1/sentences/{id}`: `{ id, text, source, meaning, translations, examples_of: [{ lemma,
  sense_id }], saying_of: [lemma] }`; `404` unless public (a published example of a public sense,
  or a saying in a public headword's published list).

## 7. Migration (one SQL migration + one data script, dry-run on a snapshot first)

1. Create `sentences`.
2. Every `example` fact (any status): create or reuse the sentence by `text_key`; payload
   `{ sentence_id }`, `object_id` the sentence, content key the sentence id. Collisions on the live
   content index (two live examples of one sense with the same text) keep the older and supersede
   the other.
3. Every `translation` with `of: "example"`: subject becomes the example's sentence, `of:
   "sentence"`, content key recomputed. Several live translations of one sentence in a language:
   keep the earliest published, supersede the rest.
4. Published `phrases` lists stay in the old string shape until regenerated: the migration converts
   each to items typed `idiom` (entry items for the entries they name) so reads and admission keep
   working, and reopens every headword's `phrases` slot (a pass record is deleted; the rescore opens
   the item) so producers regenerate typed lists. Phrase entries keep every fact.
5. Open `stuck_work` tickets on `senses` items of multiword entries: dismissed with a note; their
   items' attempts reset to 0.
6. Retire fabulate, bereftly, exaltedly, evokingly, genomically, misdemanour (via the retire path).
7. Rebuild every worklist row (`revision + 1`) so rescore and views follow.

## Deviations (as implemented)

The server implements §1–7 with these smallest faithful deviations:

1. **Migrated lists are marked.** A published list converted from untyped phrases (§7.4) would fill
   the headword's `phrases` slot, so it could never reopen. The migration stores such a list with
   `migrated: true` (read-only; never submitted): it fills no `phrases` slot and types no phrase
   entry. The headword's `phrases` item reopens, and the producer submits a typed list as a
   correction (`supersedes_id`) of the migrated one; until then its entries stay live and a phrase
   entry named only by migrated lists is untyped (keeps every slot).
2. **Every list is converted, not only published ones.** Pending, rejected, superseded, and
   retracted lists in the old string shape would no longer parse, so the migration converts all of
   them. A lemma of a list that never published that has no entry gets one, not live (602 on the
   snapshot), as a submission by text would.
3. **`translation`, not `translations`.** A public example keeps its `translation` field (string in
   the read language, by tag with `lang=all`, absent without a language) and gains `sentence_id`;
   a saying and `GET /v1/sentences/{id}` use the same `translation` field.
4. **A saying names no sense.** A `saying` item is `{ type, sentence_id }` (or `{ type, text }`);
   `sense_id` is only on entry items.
5. **Lengths.** `sentence_meaning.gloss` follows the gloss format (6–300 characters, a capital or
   quote first, a final period, no embedded example). An entry item's `text` is a lemma (2+ words,
   at most 100 characters); a saying's `text` at most 500.
6. **`parts` follows `category`.** The §4 table does not list `parts`; it needs an everyday category,
   so a phrase has it only as a compound.
7. **Synonyms by hypernym in any layer.** A live hypernym to a visible sense fills the `synonyms`
   slot whether it is everyday or a domain one.
8. **Views carry texts.** Wherever a management view or a work context shows a fact, an example has
   `{ sentence_id, text }` and each phrases item `{ type, entry_id, text, sense_id? }` or
   `{ type: "saying", sentence_id, text }`; the stored payload holds ids only and `text` is never
   part of a content key (the read schemas accept the optional `text`). The managed view also gains
   `phrase_type`.
9. **Retire response.** `POST /manage/v1/entries/{id}/retire` answers `200 { entry, retired }`;
   `retired: false` when the entry was not live; `404` for an unknown id.
10. **Import filter.** The inflection rule needs the reference list's word list; for the core import
    every candidate is a CEFR headword, so it reduces nothing there. The `-or` rule needs five
    letters and no `o` before the ending, so "floor"/"flour" and "or"/"our" never pair.
11. **Fact lists.** A fact about a sentence lists under the entry of the sentence's oldest example,
    else the headword of the oldest list naming it a saying.
