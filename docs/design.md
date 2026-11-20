# Vocnet design

Vocnet is a relational English dictionary that external agents maintain
continuously. The data is the product. A Cloudflare Worker serves a public,
read-mostly OpenAPI API and a management API that only administrators and
registered agents can use. Agents run outside the system: producers claim work
items and submit raw data, and curators handle the tickets the system cannot
settle. The system reviews every piece of data on its own and publishes it on
its own.

## Principles

- **The system covers the great majority; people handle the rest.** No data
  structure or rule is built for a handful of words. Whatever the rules cannot
  settle becomes a ticket a curator handles by hand, and the exit is reliable
  and cheap: stuck work reaches it within two passes and never loops.
- **Review and publish per fact.** The unit of review is one fact, not one
  word. A fact never waits for another fact to be ready.
- **Publish with flaws, correct later.** A review that passes or is uncertain
  publishes the fact with its confidence. Only a failing review rejects it.
  Corrections supersede published facts. Each fact is reviewed once.
- **Decision models first, the LLM decides the rest.** A kind names the
  decision models that judge it (Jev, and OpenAI's Decisions API as `luna`).
  When their scores reach the kind's thresholds they settle a pass; anything
  they do not settle goes to a general LLM, whose verdict is final.
- **Complete, not padded.** Relations are the product, so every optional slot
  must be worked: a pass may find that nothing fits, and says what it
  considered, but it may not skip the slot. Nothing asks for a quota.
- **Visibility is derived on read.** The public API shows a fact only when it
  and every node it references are published. The rule is one projection of
  the facts; the public view stores its result per entry so a read does not
  rerun it, and rebuilds it whenever the facts change (see Public view).
- **Every write converges.** Submissions are idempotent by content key, review
  is idempotent by fact status, and a reconciler re-enqueues stuck work.
- **Built to grow in stages and languages.** Headwords arrive in imported
  batches, and a new language is a new set of translation work, never a change
  to the facts already there.

## Data model

### Nodes

Nodes are stable identities. They carry only the attributes that define
identity, never reviewed content.

| Table     | Columns                                           | Identity rule                       |
| --------- | ------------------------------------------------- | ----------------------------------- |
| `entries` | `id`, `lemma` (normalized, unique), `created_by`  | One entry per lemma spelling        |
| `senses`  | `id`, `entry_id`, `pos`, `creation_key`, `created_by` | One row per sense an inventory created |
| `sentences` | `id`, `text`, `text_key` (unique), `source`, `created_by` | One sentence per text key: an example, a saying, or both |

An entry is **live** when it is admitted: an imported headword, or a phrase
that a published `phrases` fact names (see Headwords and phrases). Liveness is
the `live` flag of the entry's worklist row, with the `batch` it was admitted
in; an entry that is not live has no work items, shows nowhere publicly, and
no relation can link to it. Workers never create entries.

A sense row exists because an inventory named it: submitting a `senses` fact
creates a row for each sense it lists without an id (see Sense inventory). A
sense has no reviewed content of its own: its gloss, labels, and rank are in
the entry's inventory, and a sense shows only while its entry's published
inventory lists it. Correcting a sense's part of speech means a new sense.

A **sentence** is an example sentence or a saying (a proverb, maxim, or
saying), shared by every fact that names it. `text_key` is `textKey` of the
text (`server/domain/term.ts`); `source` is free-text provenance (a book or
film title), null when a producer made it up. Workers never create sentences
directly: a submission that names a sentence by `text` (an `example`, or a
saying in a `phrases` list) resolves it by text key to the existing row or a
new one created in the same submission, before the fact is stored, and the
stored payload holds the id. What a sentence is, is derived on read: a
**saying** while a published `phrases` list names it with type `saying`, an
**example** while a published `example` fact links it to a sense; it may be
both. Nothing stores the type. A sentence is the subject of its translations
and of its `sentence_meaning`.

### Facts

Everything else is a fact: one row in `facts`, one reviewed claim.

| Column          | Meaning                                                        |
| --------------- | -------------------------------------------------------------- |
| `id`            | Stable fact ID                                                 |
| `kind`          | Key into the fact-kind registry                                |
| `subject_id`    | The node the fact is about: an entry, a sense, a sentence, or for a translation of a collocation that fact |
| `object_id`     | The node it points at besides its subject: a relation's target sense, an example's sentence; else null |
| `content_key`   | Deterministic key of the identifying payload, for dedupe       |
| `payload`       | Kind-specific JSON, validated by the registry schema           |
| `status`        | `pending`, `published`, `rejected`, `superseded`, `retracted`  |
| `slot`          | The slot the fact holds on its subject (`slotOf` in the registry): `''` for a kind with one live fact per subject, the language for a translation, the part of speech for a productive use, null for a kind without the limit |
| `supersedes_id` | Fact this one corrects, if any                                 |
| `author`        | Agent or admin principal that submitted it, or `system:classifier` for a fact the server classified |
| `review`        | Reviewer, verdict, confidence, reason, raw detail, reviewed at |

A partial unique index on `(kind, content_key, subject_id)` over `pending` and
`published` rows (the *live* facts) makes resubmission return the existing
fact. `content_key` precedes `subject_id` so lookups by content, such as finding
the entries that own a form, use the same index. Another partial index over
`rejected` rows on `(kind, subject_id, content_key)` finds earlier rejections
of the same claim (see Submissions).

### Fact kinds

The registry in `server/domain/fact-kinds.ts` is the single source of truth.
Each kind declares its subject type, cardinality, payload schema, content key,
decision models, write rules, and review plan. Adding a kind is one registry
entry plus its payload schema in `shared/facts.ts`.

| Kind            | Subject | Cardinality | Payload                                                  | Review |
| --------------- | ------- | ----------- | -------------------------------------------------------- | ------ |
| `senses`        | entry   | one         | `{ senses: [{ id, pos, gloss, register?, region?, rank }] }` in display order, `rank` `common` or `extra` | Jev per gloss, then LLM on the whole inventory |
| `form`          | entry   | many        | `{ form, type, pos?, ipa?, accent? }` (plural, past, variant…) | Jev, then LLM; LLM alone for a variant or a form with ipa |
| `relation`      | sense   | many        | `{ type, target_sense_id, domain? }` (`domain` only on a hypernym: `biology` or `medicine`) | Jev at the type's threshold, then LLM; LLM alone for a domain hypernym |
| `pronunciation` | entry   | many        | `{ ipa, accent, strength?, pos? }` (accent `us` or `uk`) | LLM |
| `example`       | sense   | many        | `{ sentence_id }` (submitted as `{ sentence_id }` or `{ text }`); object and content key the sentence | LLM |
| `translation`   | sense, sentence, or a collocation fact | one per language | `{ language, of, text }` (`of`: `sense`, `sentence`, or `collocation`) | a sense equivalent Jev or luna, then LLM; a sentence or collocation LLM |
| `topic`         | sense   | many (≤ 3)  | `{ topic_id }` (a leaf topic)                            | mean of Jev and luna, then LLM |
| `grammar`       | sense   | one         | `{ countability?, number?, article?, transitivity?, position?, agreement?, patterns?, prepositions? }` | Jev, then LLM |
| `morphology`    | entry   | one         | `{ parts: [{ form, role, meaning?, lemma? }], shortened?: { type, of } }` | Jev, then LLM |
| `collocation`   | sense   | many (≤ 5)  | `{ text, pattern }`                                      | LLM |
| `syllables`     | entry   | one         | `{ syllables: [string] }` (`["a", "bil", "i", "ty"]`)     | luna, then LLM |
| `phrases`       | entry   | one         | `{ phrases: [{ type, entry_id, sense_id? } \| { type: "saying", sentence_id }] }` (no cap) | Jev per item, then LLM |
| `sentence_meaning` | sentence | one      | `{ gloss }`: what a saying means and when it is said      | Jev, then LLM |
| `productive_use` | entry  | one per part of speech | `{ pos, native, learner }`: whether native speakers and a C1 learner use the word or only understand it | Jev per tier, then LLM |
| `image`         | sense   | one         | `{ image_id, sentence_id? }`: a stored picture of the sense, or of one of its examples (see Pictures) | LLM, looking at the picture |

A kind with cardinality *one* admits a single live fact per subject,
*one per language* a single live translation per subject and language, and
*one per part of speech* a single live productive use per entry and part of
speech: an
entry has one inventory, one word formation, one syllable division, and one
phrases list, a sentence one meaning, and a sense one grammar fact and one picture. Changing it means submitting a
correction that supersedes the published fact; a second one without
`supersedes_id` is a conflict. D1 enforces this with two partial unique indexes
on `(kind, subject_id, slot)` over rows whose `slot` is set. The *holder*
index covers the published fact and any pending fact that corrects nothing;
the *pending* index covers every pending fact. So a pending correction may sit
beside the published original, and a second pending fact or a second holder is
refused. A write that one of these indexes, the live-content index, or the
one-live-correction index refuses answers `409 conflict`.

#### Sense inventory

A `senses` fact is the entry's whole sense inventory: every sense a learner's
dictionary (Oxford Advanced Learner's, Longman, Cambridge) gives the word, each
with its part of speech, gloss, optional register and region, and `rank`.
`common` senses are the general-knowledge ones a learner's dictionary lists,
most common first across parts of speech; `extra` senses are rare, archaic,
technical, or specialist ones. The common senses come first, then the extra
ones; at least one is common. Extra senses never count toward completeness.

- **Ids.** A sense the inventory keeps names its `id`, so its relations,
  examples, and translations stay attached. A sense without an `id` is new:
  submitting the inventory creates its sense row (`insertSenses`, keyed by
  entry, part of speech, and the gloss's text key, so a concurrent duplicate
  converges on one row) and stores the inventory with every sense named by id.
  An id that is not a sense of the entry is `422 invalid_reference` (`admit`).
  A sense the published inventory leaves out is gone: it no longer shows, and
  neither does anything attached to it.
- **Content key.** Each sense's `pos:gloss` text key with its labels, the
  common ones in order and the extra ones sorted, so resubmitting the same
  inventory returns the live one.
- **Settled once.** Only a `senses` work item submits an inventory. Once the
  entry has a published inventory its senses are fixed: anyone but a curator
  who submits another, as a correction or not, gets `403 inventory_settled`
  ("This entry's sense inventory is published, so its senses are fixed;
  reference them, or leave a note for a curator."). A curator corrects it with
  a curated correction (see Curation); every question about a sense reaches the
  curator as a ticket. This keeps producers of different items from adding and
  removing each other's senses.
- **Current inventory.** The entry's current inventory is the live one that no
  live correction supersedes (`currentInventory` in `server/domain/inventory.ts`),
  so a pending correction stands for its original in the live view, and the
  published view reads the published one.
- **References.** A relation, and any fact about a sense, names a sense that a
  published inventory of a live entry lists; anything else is `422
  invalid_reference` with a message telling the producer to name the word in
  `blocked_on` and complete the item (see Work items, Passes). The queue runs a
  batch's inventories (stage 1) before its relation stages, so in practice the
  ends exist by the time relations are worked.
- **Review.** Jev is asked one question per sense (`sense_1`, `sense_2`, …),
  whether the word has that meaning in that part of speech with those labels;
  when every answer reaches 0.8 the pass settles. Otherwise the LLM judges the
  whole inventory, numbered, common in order and then extra, and fails only an
  inventory that misses a main general-knowledge sense a learner's dictionary
  lists for A1 to B1 learners, holds two duplicate or over-split common senses,
  puts a rare, archaic, technical, legal, specialist, or regional-only sense in
  common, gives a sense the wrong part of speech, puts a main sense every
  learner's dictionary prints in extra, leaves the word's best-known meaning
  out of the first three common senses, or has a wrong gloss or label. It never
  fails for another order of common senses, a borderline placement (successive
  reviews of *go*, *food*, and *block* moved the same senses back and forth), or
  a missing rare sense; the part of speech is the grammatical function, so an
  idiom or fixed phrase is never failed for not being labelled idiom, phrase,
  or saying; and an entry whose every sense is technical, specialist, or
  regional ranks its main sense common, never failed as misplaced. Its reason
  names every sense to change. Entries are
  case-sensitive: the rubric judges only the exact spelling, and when other live
  entries are spelled like the lemma but for letter case, the review context
  carries their lemmas (`caseVariants`, read on `entries_lemma_case_idx`) and the
  rubric names each as a separate entry whose senses are never missing here
  ("May" the month is not missing from "may"). This is not a fallback: the
  lookup of the entry under review stays exact.

The migration `redesign` (`scripts/migrate/redesign.py`) merged every entry's
senses and sense list into one inventory, published when its list was
published and pending otherwise.

#### Headwords and phrases

The headword list is imported data, never created by a worker. Each headword
records the batch it was imported in; importing a batch admits its headwords
(`nodes.admit`: the entry row if it is missing, then `live` and `batch` on its
worklist row, keeping an earlier batch), and their work items follow from the
gaps on the next rescore, so the producers continue without a code change.
Duplicates are settled before an import (`filterHeadwords` in
`server/domain/headword-import.ts`, applied by `importCoreEntries` and any batch
import): a lemma already admitted is skipped; single letters other than "a"
and "I", contractions and clitics ("'s", "'m", "'re", "can't"), and lemmas with
a character other than a letter, space, hyphen, or apostrophe are skipped; a
regular inflection (`-s/-es/-ies`, `-ed/-ied`, `-ing`, `-er/-est`) is reduced
to its base when the base is a candidate or an entry and the reference CEFR
list does not list the form itself ("left", "saw", "found" stay); and an
American spelling (`-or`, `-ize`, `-yze`, `-er`, `-og`) whose British spelling
(`-our`, `-ise`, `-yse`, `-re`, `-ogue`) is a candidate or an entry is merged
into it, recorded as a curated `variant` form when the call creates the British
entry. A short word never pairs (`-or` needs five letters and no `o` before it,
so "floor" and "flour" both stay). The response reports what each rule skipped
(`skipped.letters`, `contractions`, `characters`, `inflections`, `variants`).

| Batch | Headwords |
| ----- | --------- |
| 1 | The CEFR profiles (`POST /manage/v1/entries/core`) |
| 2 | Zipf ≥ 4, reduced to base forms, minus those already in |
| 3 | Zipf ≥ 3.5 |
| 4+ | A full dictionary base-form word list, in steps |

`POST /manage/v1/entries` with `{ lemma, batch }` admits one headword
(curators only; producers get `403`): `201` when the entry was created, `200`
when it existed, and either way it is live from then on in its earlier batch
or this one. Admitting a word reopens every optional slot a pass was blocked on
it (see Passes).

`POST /manage/v1/entries/{id}/retire` (curators) takes an admitted entry off
the wordlist: it stops being live (a revision bump, and the entries linked to
it are touched, as for a dropped phrase), so it has no work items and shows
nowhere; retiring an entry that is not live changes nothing (`retired:
false`). It is `409 conflict` while a published phrases list names the entry
as an entry item (correct that list instead), and `404` for an unknown id.
`POST /manage/v1/entries` admits it again.

A **phrase** is an entry of its own, with its own inventory, translations,
examples, and relations. A headword's `phrases` fact lists the phrases filed
under it, each **typed**: `phrasal_verb` ("give up"), `compound` ("bank
account"), `idiom` ("put the cart before the horse"), `fixed_phrase` ("at all",
"in front of"), or `saying` ("look before you leap"), with no cap. A saying
names a sentence and never becomes an entry; every other type names an entry.
An item may name `sense_id`, a sense of the headword's current inventory the
phrase plainly belongs to (a compound or set phrase built on that sense);
idioms, phrasal verbs, and phrases tied to no sense omit it. A plain
description built from the words' ordinary meanings ("white rice", "paper
handkerchief") is not listed, and a phrase may be listed under several
headwords ("in front of" under *front*).

- **Write rules.** An item is `{ type, entry_id | sentence_id, sense_id? }`, or
  submitted `{ type, text, sense_id? }`: a text resolves to the entry with
  exactly that lemma, created **not live** when there is none (a non-saying
  type), or to the sentence with that text, created when there is none (a
  saying). Nothing is created for a list that does not fit: the write rules
  run on the provisional ids first. A non-saying item is a multiword lemma
  (text `400`, id `422`) containing the headword; a saying is a complete
  sentence (a capital letter or quote first, at least two words) and names no
  sense; each target is named once; a `sense_id` is a sense of the headword's
  current inventory; a list on a multiword entry is refused; each a `422
  invalid_reference` naming the items. The content key is the sorted
  `type:id[:sense_id]` of the items.
- **Review.** Jev is asked one question per item (`phrase_1`, …) naming its
  type and, when given, its sense: whether a learner's dictionary prints it as
  that type of the headword or its meaning is not the sum of its words, or for
  a saying whether it is an established saying; the LLM rubric numbers each
  item with its type and sense, passes idioms, fixed phrases, and the phrasal
  verbs a learner's dictionary prints even when transparent ("sit down", "come
  back"), fails a plain description or a coined combination ("telephone in",
  "party down"), a wrong type (a complete sentence is always a saying), a
  sense the phrase does not belong to, never fails for a missing phrase or a
  missing sense, and names each wrong item by number. Idiom and fixed phrase
  are one group in review: a question asks "an idiom or fixed phrase", and
  typing one as the other is never a failure (they are phrase entries with
  the same work; reviews flipped the same phrases between them).
- **Admission.** Publishing a phrases list makes each entry item live in its
  headword's batch (`admitPhrases` in `server/usecases/review.ts`), so the
  phrase gets its own work items, which queue with its headword's batch. A
  saying admits nothing; its sentence gets translation and meaning work on the
  headword. When a correction drops an entry item, the phrase stops being live
  unless another published list still names it as an entry item.
- **Phrase type.** A phrase entry's type is derived on read: the type the
  earliest published list naming it gives (by creation). It decides which
  slots the phrase has (see Gaps) and shows as `phrase_type`.

The headword's public entry shows the public phrases its list names, grouped
under the sense they are filed under and otherwise by type, and its sayings
(see Public API).

The migration `sentences` (`scripts/migrate/sentences.py`) moved every example
onto a sentence, every example translation onto its sentence, and every
published phrases list into typed items (`idiom`) and deleted the phrases
passes, so producers submit typed corrections of the migrated lists. Deleting
every pass also reopened about 3,400 headwords whose pass had found no phrases;
`scripts/migrate/phrase_passes.py` restored those passes from the backup taken
before the migration (a headword that had since gained a list keeps it). A migrated
list's content key carries a `migrated:` prefix, so a typed correction naming the
same items with the same types is a new fact that types them, not a duplicate of
the migrated list (`scripts/migrate/migrated_list_keys.py` rewrote the stored keys).

#### Translations

A `translation` translates one item a learner reads into one served language:
a sense (its learner's-dictionary equivalent), a sentence (an example or a
saying), or a collocation. `of` says which, and `subject_id` is the sense id,
the sentence id, or the collocation fact id; a subject that is not what `of`
claims is `422 invalid_reference`. One live translation per subject and
language (`slot` is the language): changing one means superseding it. A sense
equivalent is at most 200 characters and lists each alternative once,
separated by `；`. A sentence is translated once, for every entry that uses it.

A translation work item is one entry and one language, and translates every
listed item of the entry in one pass, but each translation is stored and
reviewed on its own. A new language is a new set of translation items; no
existing fact changes. When an example or collocation is superseded, a new
sentence or collocation is current, so the old one's translation stops showing
(visibility is derived on read) and the entry's translations item reopens for
the new one; the original's own facts are untouched. Examples carry only their
sentence, so adding a translation never supersedes an example.

A sense equivalent is judged by Jev (passing at 0.9) and luna (at 0.8), either
settling a pass: each passed correct equivalents the other missed, and Jev at
0.8 passed four wrong ones that luna failed. The LLM decides the rest with a
bilingual-dictionary rubric that accepts verb-like or descriptive renderings
of function words, bracketed usage notes, and for a noun sense an equivalent
that also reads as a verb or adjective, since Chinese does not mark part of
speech; it rejects a wrong meaning, a different sense, a noun-only equivalent
of a verb sense, unnatural wording, or equivalents of unrelated senses. A
sentence or collocation translation is a fluency judgement neither decision
model makes, so the LLM judges it alone against the text: a sentence with the
first sense it is a live example of, and for a saying its meaning (an
established saying of the language with the same meaning passes too).

A **sentence meaning** (`sentence_meaning`, `{ gloss }`, about a sentence, one
per sentence) is a dictionary-style gloss of what a saying actually means and
when it is said, never the saying itself; it is required only of sayings. Jev
is asked whether the saying means the gloss; the LLM rubric fails a literal
meaning, a wrong one, or the saying quoted as its gloss.

The migration `redesign` turned every sense translation into the new shape and
split the Chinese of every example into its own translation fact.

#### Productive use

Linguistics calls the words a speaker uses in speech and writing their
*productive* (active) vocabulary and the words they only understand their
*receptive* (passive) vocabulary. A **productive use** (`productive_use`,
`{ pos, native, learner }`, about an entry, one per part of speech of its
common senses) says, for two tiers, whether the word in that part of speech
is active (`true`) or passive (`false`). The name is not `productive`, which
morphology means otherwise.

- **native**: native speakers use it themselves, in every register: everyday,
  formal written, and the informal and slang words of their own variety. It is
  passive only for archaic and literary words and specialist terms outside
  general knowledge (henceforth, betwixt, red shift).
- **learner**: an advanced, CEFR C1 learner who studies, works, and lives in
  English needs to use it: everyday words, academic and workplace vocabulary,
  and common phrasal verbs, idioms, and fixed phrases (give up, a piece of
  cake). It is passive for slang, jokey or strongly colloquial idioms (kick the
  bucket), informal words of only one variety of English (gobsmacked,
  knackered; a standard regional word such as truck is not one), and every
  word passive for natives. So `native: false` with `learner: true` is `400`.

`pos` must be the part of speech of a common sense of the entry's live
inventory, else `422 invalid_reference`; extra senses are passive for both
tiers and take none. The content key is `pos|native|learner`, the slot the part
of speech. Both tiers are one fact so a contradiction between them is caught in
one review.

Each tier has two Jev questions, one per value, about the word, the part of
speech, its common senses with their labels, and its Zipf frequency: whether
the tier uses the word itself, and whether the word is of a passive kind. A
question asked one way round scores the other side poorly: in the 2026-11-14
trial (180 hand-labelled words), "is recognising enough" passed 90 of 113 words
a learner must use.

**The server classifies productive uses itself**; it is the one kind no agent
produces, because it is a choice among four values over data the entry already
has, which Jev answers in a tenth of a second, where an agent session cost
twenty turns a batch of ten. The scheduled run works the open `productive_use`
items (see Work items) as the principal `system:classifier`: Jev is asked all
four questions, each tier takes the value whose question scores higher (a tie
is active), and natives' passive makes the learner's passive whatever it
scored. When each chosen score reaches 0.8 (for a passive native, its score
alone), the fact is submitted already decided and publishes with a `jev` review
holding the four scores, never entering the review queue; at 0.8 the trial let
no wrong value through and the first run settled about four in five. Otherwise
the LLM is shown the same data and rules and chooses (`{ native, learner,
confidence, reason }`, natives' passive again forcing the learner's), and the
fact publishes with a `jev+llm` review. The submission passes every write rule;
one that refuses it (content a review rejected) is recorded as the item's pass,
so after two passes the item becomes a curator's ticket. A reviewer transport
or protocol failure ends the run with the unworked items released for the next.
New entries, inventories that publish or change, and anything else that opens
the slot get classified the same way on the next run. A productive use an agent
or a curator submits, such as a correction, is reviewed as above: Jev is asked
the two questions of the claimed values, both must reach 0.8, and otherwise the
LLM judges both tiers together. A part of speech the live inventory no longer
has a common sense of is unreviewable.

#### Syllables and form pronunciations

- **Syllables** divide the written word by its pronunciation, to help a
  learner say it and spell it by sound: one part per vowel sound of the careful
  (citation) pronunciation, a dropped vowel and a single-letter one included
  (`choc·o·late`, `e·na·ble`, `war·ri·or`); a diphthong or a vowel with its r is
  one (`wire`). Any standard careful pronunciation decides the count, British or
  American, of any sense (`des·ert` or `de·sert`). A consonant between two vowel
  sounds preferably starts the next part (`com·for·ta·ble`), but its place never
  fails a division as long as each part can be said alone and a letter group
  spelling one sound (`sh`, `th`, `gh`) stays whole. An abbreviation or
  initialism is one part. Word parts and print hyphenation never decide the
  count (`en·able` is wrong): the word's meaningful parts are its morphology.
  Joined, the syllables spell the lemma exactly, and none has a space; a phrase
  has no syllables (its words are their own entries), so a syllables fact about
  a multiword entry, or one that does not spell the lemma, is `422
  invalid_reference`. The content key is the syllables joined with `·`. luna
  judges the division first and settles a pass at 0.9; otherwise the LLM judges
  it by the same rule. A single-word entry has a `syllables` gap until it has
  one live syllables fact, and the entry document shows them as `syllables`
  (null when none is published).
- **Form pronunciation.** A form may give `ipa` and `accent` together (one
  without the other is `400`), under the IPA write rule of pronunciations,
  mainly for an irregular form ("went" /went/, the past "read" /red/). The
  pronunciation is part of the content key (`type|form|pos?|accent:ipa`), so
  adding one to a published form is a correction that supersedes it; the
  unlabelled key stays the prefix every lookup by spelling matches. A form with
  a pronunciation goes to the LLM alone, whose rubric also judges the
  transcription in that accent. **Irregular** is computed, not stored
  (`isIrregularForm` in the registry): an inflection of a single word that no
  regular spelling rule gives, the suffix (`s`/`es`, `ed`/`d`, `ing`,
  `er`/`r`, `est`/`st`) added plainly, after a doubled final letter, a dropped
  final e, a consonant-y turned to i, an ie turned to y, or a c taking k. So
  "went", "children", "better", and "would" are irregular, and "stopped",
  "making", "dying", "carries", and "panicked" are not; a variant or a
  phrase's form never is. Each live irregular form without a live
  pronunciation is named by the `form_pronunciations` gap; regular forms need
  none.

Each inflecting form type belongs to one word class. Plurals are noun forms;
past, past participle, present participle, and third-person singular are verb
forms; comparative and superlative are adjective or adverb forms. The form
question names that class, so Jev judges "breaded" against the verb "bread",
not the dominant noun. A spelling variant goes to the LLM alone (see Spelling
variants).

#### Spelling variants

One word has one entry, and the British spelling is the main one: American and
other spellings are `variant` forms on it ("color" on "colour", "yogurt" on
"yoghurt"), never entries of their own. Jev cannot tell which spelling of a
pair is British, so a variant form is judged by the LLM alone, whose rubric
fails a British spelling recorded as a variant of an American one. A variant
has no region field: the rule is that a variant on a British entry is not
British. Homographs and words of their own stay entries (a/an, story/storey,
practice/practise, licence/license, program/programme, metre/meter). Lookups
stay exact: `GET /v1/entries/color` is `404`, while `GET /v1/forms/color`
finds "colour" and search ranks an entry whose variant is the query as its
exact lemma. The headword import merges spelling variants before they become
entries (see Headwords and phrases).

Relation types are `synonym`, `antonym`, `hypernym`, and `part_of`. Each Jev
question says that two
senses of one word never stand in a relation, and the hypernym question also
says that mutual substitutability is synonymy, that hypernymy holds only
between nouns or between verbs, and that a generic head such as "cause" does
not count. A relation links senses of two different entries; a relation inside
one entry, or from a sense to itself, is `422 invalid_reference`. Synonyms and
antonyms are symmetric, so each is stored once per pair of senses: submission
orients it with the smaller sense id as `subject_id` and the larger as
`target_sense_id`, and a submission from the other end returns the stored fact
with `created: false`. Hypernyms and `part_of` keep the direction they were
submitted in. The public entry lists a relation on both senses, grouped by what
it says about each (see Public API), and gaps count it for both. A relation is
reviewed with the relation question only: whether each sense is an established
meaning is its inventory's claim, and the relation shows only while a
published inventory of a live entry lists both senses.

#### Relations

An audit of 100 random published relations (seeded sample of 13,182) found
strict precision 84%: 90.7% for relations Jev passed alone and 64% for those
the LLM published over an unsure Jev. Over the whole store, the LLM had
published 323 relations over a Jev answer under 0.5 (142 hypernym, 89 synonym,
79 `part_of`, 13 antonym); about half of those synonyms and almost none of the
others held. Structural checks found 38 (sense, entry) slots holding two
relation types (78 relations), 14 entry pairs each a hypernym of the other (28
relations), and 40 `part_of` relations from a body part to a person-type noun
(head `part_of` princess, hand `part_of` worker). A later look at the network
found the taxonomy inconsistent where like decisions were made in separate
passes (dog under canine, wing part of turkey, rail, and pen instead of bird)
and quota-driven where a sense had to reach two relations ("bird" listed only
turkey as a kind; "animal" listed he, girl, head, and baby). The rules that
follow:

- **Layers.** A hypernym is in the *everyday* layer, the taxonomy a learner
  uses, unless its payload names a `domain` (`relationDomainSchema`: `biology`,
  `medicine`), the specialist taxonomy it belongs to. Only a hypernym carries a
  domain: a synonym, antonym, or `part_of` with one is `400 invalid_request`,
  "Only a hypernym carries a domain: a specialist taxonomy layers broader terms,
  never synonyms, antonyms, or parts." The domain is part of the claim and of
  the content key (`hypernym|<target>|biology`), so the same target in two
  layers would be two facts; a broader term belongs to one layer, so the second
  is refused (see Write rules). Neither layer invents nodes: every node is a
  real headword with its own entry. The everyday layer is what reads show by
  default; a domain layer shows only when asked for (see Public API). A sense
  may have several everyday categories (dog: animal, pet). Narrower terms are
  never asked of a category word: the members of "animal" are the senses whose
  hypernyms lead to it, walked on read (`GET /v1/senses/{id}/members`).

- **Decision.** Jev judges an everyday relation with the rules of its type
  written into its question, at the type's threshold (`RELATION_PASS_AT`): a
  synonym passes at 0.7, where the gate evaluation found the synonym wording
  compresses scores (0.7 held 12 of 12, 0.8 passed one pair in nine), an
  antonym at 0.9, and a hypernym or `part_of` at 0.8. Anything Jev does not pass
  goes to the LLM, which decides. The layer and most-general-whole rules of
  hypernyms and parts are in Jev's question too, so a confident Jev pass of dog
  hypernym canine no longer settles; a validation run on snapshot data
  confirmed the rewritten questions stop those errors before the switch. A
  domain hypernym goes to the LLM alone.
- **Rubric.** The LLM rubric fails a body part, organ, or limb as part of a
  person-type noun (a role, kinship term, occupation, title, or nickname: a
  head is part of a person, not of a princess); applies a substitution test to
  hypernyms (a source gloss "A <target> …", or a target that alone paraphrases
  the source, is a synonym), requires the reviewer to name the feature that
  sets the source apart within the target's class, and fails a near-generic
  head (`GENERIC_HYPERNYM_HEADS`: the most frequent hypernym targets such as
  "person", "group", "move", "change", "meet", and "thing", "do", "make",
  "be", "have"); fails co-hyponyms of one set (titles, colours, days, numbers)
  and converse role pairs (teacher and student, buyer and seller) as antonyms;
  fails a target that is archaic or old-fashioned in its sense; fails a target an A1 to B2
  learner cannot use, or of another register, for a source in neutral standard
  English (slang "ice" or "waste" for killing, "abstain" for sharing), unless the
  source carries that register; and fails a light verb ("make", "do", "take", "give", "have",
  "get") as a synonym of a full verb. It lists the target entry's other senses
  and fails a relation when one of them is the better match for the source.
  The rubric then states the layer. An everyday hypernym (`EVERYDAY_LAYER`)
  must be a category word learners use and a learner's dictionary defines the
  word by ("a dog is an animal", "a dog is a pet", "an eagle is a bird"). The
  broad classes taught in school science (mammal, bird, fish, insect, reptile,
  amphibian) are everyday categories too, so "dog" may be an animal, a pet, and
  a mammal. It fails a technical taxon below them or a term a learner would not
  use for the category ("canine", "feline", "passerine", "rodent", "primate",
  "carnivore"), which belongs in a domain layer,
  and a target that is no category a learner files the word under. A domain
  hypernym (`domainLayer`) passes only when the target is a real term of that
  field's taxonomy at the rank the field puts above the source ("dog" a kind of
  "canine", "canine" of "carnivore", "carnivore" of "mammal" in biology), and
  fails an invented intermediate node, a descriptive phrase, an everyday
  category word, or a term of another field; its Jev question asks for the kind
  of link "in the taxonomy of biology", and the register rule for a learner's
  target is left out. A `part_of` attaches a part to the most general common
  whole it is a part of (`PART_OF_WHOLE`: a wing to a bird, not to a turkey; a
  tail to an animal, not to a dog; a wheel to a vehicle or a car, not to a
  taxi), failing one attached to a narrower kind of that whole, and never to a
  person-type noun.
- **Write rules.** Checked at submission, and when a rejected relation is
  re-reviewed back to life, against the live relations between the two
  entries (`admitLink` in the registry; a read before the write, as `admit`
  is). A source sense relates to a target entry by one type only, a symmetric
  type occupying the slot from both of its ends: "This sense already has a live
  <type> relation (<id>) to a sense of the target's entry; a sense relates to
  another entry by one type only. Retract that fact first if <type> is the
  better type." A hypernym may not close an entry-level 2-cycle: "A live
  hypernym relation (<id>) already makes a sense of the target's entry a kind
  of this entry; two entries cannot each be a kind of the other." A hypernym to
  a sense of an entry that this sense already reaches by a hypernym of the
  other layer is refused: "This sense already has a live everyday hypernym
  (<id>) to a sense of the target's entry; a broader term belongs to one layer.
  Retract that fact first if the biology layer fits it better." All are
  `422 invalid_reference`. No fact waits on another: the rule reads only which
  facts are live.
- **Padding.** An end rule (`admitEnds`, whose `LinkEnd` carries each end's
  entry lemma and its live spelling variants) keeps a sense from being padded
  with another spelling of itself. A synonym never links two spellings of one
  word: when either end's entry records the other's lemma as a live `variant`
  form, the synonym is refused, "\"practise\" and \"practice\" are spellings of
  one word: one entry records the other as a live spelling variant, so they are
  never synonyms. Relate a different word." (the audit found three on
  *practise*), `422 invalid_reference`, read before the write as `admit` is. No
  sense caps its narrower terms: the earlier cap of twelve kept "animal" from
  listing its animals, while the padding it stopped (a dozen loose narrower
  terms of *kill* and *share*) is what the everyday rubric now fails. With no
  quota on relations, nothing asks a producer for a second loose one.

### Topics

Learners find words by topic: the scene they need them in ("words I need at
the hospital") or the subject area they belong to ("emotions"). The server keeps a two-level controlled taxonomy in the `topics`
table (`id`, `parent_id`, `name_en`, `name_zh`, `position`, `image_id`): 16 categories
(`parent_id` null), such as `body-health` "Body and health", over 147 leaf
topics, such as `hospital-doctor` "At the doctor and hospital". Ids are stable;
names are display labels; `position` orders siblings. The owner curates it, so
its rows change only by migration (`topics_seed` inserted the approved taxonomy);
agents cannot create topics.

A category or leaf topic shows a picture, which a curator sets with `PUT
/manage/v1/topics/{id}/image`: the body is the picture itself, a 1024×1024 WebP
of at most 300 KB, as every picture is (see Pictures); a producer agent is
`403`, an unknown topic `404`. The picture is stored before `image_id`
names it, so a topic never names a file that is not there, and setting the same
picture again changes nothing. The pictures are generated outside the server
and checked before they are set; a picture is a curator's choice, not a
reviewed fact.

A `topic` fact tags one sense with one leaf topic. Topics are tags, not
relations between words: a relation to an "anchor word" would need an anchor
that is itself ambiguous, a fuzzy "related to" type that review cannot judge,
and would fill a relation slot; a tag points into a fixed hierarchy
the server owns. The registry gives the kind three more properties, each
enforced by the submission use case and never by name:

- `topic`: the payload's `topic_id` must name an existing **leaf** topic. An
  unknown id or a category id is `422 invalid_reference`.
- `subjectPos`: the sense must be a noun, verb, adjective, or adverb; a
  function-word sense is `422 invalid_reference`. Function words belong to no
  topic.
- `maxLive`: a sense holds at most 3 live topic facts. The insert counts the
  live ones in the same statement, so concurrent submissions cannot pass the
  limit; a fourth is `409 conflict` with a message naming the limit, and so is
  re-reviewing a rejected topic fact into a full sense. The re-review counts
  in its own conditional write too, so it cannot race a submission past the
  limit. The count leaves out the fact a correction supersedes, because the
  correction takes its place: a topic on a full sense is replaced by a
  correction. A fact has at most one live correction, and a correction goes
  live only while its original is published (invariants I1 and I2 under the
  fact lifecycle), so a correction and its original never both publish.

The content key is the topic id, so resubmitting a tag returns the live fact.
A tag means "a learner meets or needs this sense mainly in this topic", not
"the sense can turn up there". Jev and luna are asked the same question, with
the rule written into it, and their mean score against the mean threshold
settles a pass: each missed a few loose tags the other caught ("full" in
hotels, "stop" in driving), and their mean passed none. Otherwise the LLM
decides. The rubric passes only when the topic is
where a learner characteristically meets or needs the sense: the sense is
typical vocabulary of that scene or subject area, a word a learner studying the topic should learn,
whether the topic is a scene (at the hospital) or a subject area (emotions,
colours and shapes). It fails a general-purpose sense usable in many scenes
that merely can appear in this one, a loose association, or a topic that fits
a different sense of the word. It lists audited passes ("oven" in household
appliances, "credit" in banking, "angry" in emotions) and fails ("full" in
hotels, "stop" in driving, "event" in news) as examples. A sense may be
core to several topics ("ticket" in trains and in buses); each tag is judged
on its own. The rubric keeps uncertain for a sense or topic it cannot judge at
all and says to fail when it doubts the sense is typical vocabulary of the
topic; an uncertain verdict still publishes, as in every chain. It sees the
entry's other senses.

`GET /v1/topics` returns `{ categories: [{ id, name: { en, zh }, image_url, sense_count,
entry_count, topics: [{ id, name: { en, zh }, image_url, sense_count, entry_count }] }] }`
in display order, the names keyed by language as a sense's topic tags name
them, and `image_url` the path of the topic's picture (`/v1/media/{id}`), null
until a curator sets one. `sense_count` is how many public senses `GET /v1/topics/{id}/senses`
lists for the topic, a category counting each sense of its leaves once;
`entry_count` is how many public entries `GET /v1/entries?topic=` lists, those
with a common sense tagged with it. Both are counted from `public_sense_topics`
on read, and the response is a list, cached for five seconds.
`GET /v1/topics/{id}/senses`
returns a keyset page `{ lang, items, next_cursor }` of sense summaries (see
Public API), each with `rare` (the entry's inventory ranks the sense extra), of the senses that published topic facts tag with that leaf, or
with any leaf of that category, each sense once, in lemma then sense-id order. A sense appears
only while its topic fact is published and a published inventory of its live entry lists it. An unknown
id is `404 not_found`, without a fuzzy fallback. The listing reads the public
view's `public_sense_topics` rows, one per topic tag of a public sense, keyed
`(topic_id, lemma, sense_id)`, so a leaf is one index range in page order.
The public entry lists each sense's `topics` as `{ id, name, category: { id,
name } }`, each name in English and the requested language. The category is
the topic's parent in the taxonomy as it is when the entry is read: the stored
document holds the tag and the read joins the category, so it is never stale
and the taxonomy is part of the document's ETag. A tag whose topic is not a
leaf of the taxonomy fails the read. Topic facts appear wherever the
management API lists facts.

### Pictures

Pictures are media files in the R2 bucket bound as `MEDIA` (`vocnet-media`;
`vocnet-media-preview` for previews), each under the lowercase hex SHA-256 of
its bytes with its content type. The id names the content, so a file never
changes: `GET /v1/media/{id}` answers it with `Cache-Control: public,
max-age=31536000, immutable` and the id as its ETag (`If-None-Match` with it is
`304`), and an id no file has is `404`. Nothing deletes a file; one no row names
costs only its storage.

A picture is a 1024×1024 WebP of at most 300 KB, small enough to load a list of
them at once; its size is read from the WebP header, and any other file, size,
or a larger one is `400 invalid_request` naming what is wrong. An agent stores
one with `POST /manage/v1/media`, whose body is the picture itself; the answer
is `{ id, url }`, and storing it again changes nothing.

An `image` fact gives a sense its picture: `{ image_id, sentence_id? }`, one
live per sense, keyed by the picture's id. Its picture must be stored (`422
invalid_reference` otherwise). A picture shows the sense itself in one scene;
only a sense no picture can show, such as a conjunction, takes a picture of one
of its examples, named by `sentence_id` (the fact's object), and that picture
is always shown with the sentence. Producers draw them with the model gateway's
image model from the sense's gloss, or from the sentence, in one house style.

The LLM reviews a picture by looking at it (`LookPlan`): it is first sent the
picture alone and names the five headwords it most likely illustrates, then the
picture with the lemma, part of speech, gloss, the sentence if any, and those
guesses, and judges it. The guesses catch a picture of a merely related idea:
"two people laughing" for *break the ice* is guessed as *laugh*. They do not
decide alone, since a literal *break the ice* or a riverbank for the financial
*bank* is guessed right too. The rubric fails another sense, a literal idiom, a
merely related idea, any letters, numbers, or logos, offence or real people and
brands, and malformed hands, faces, or objects; it never judges the drawing
style, which the producer's prompt sets, because judging it failed four of ten
good pictures for their backgrounds. Guesses that break their contract are a
reviewer failure, so the queue retries.

The public view shows a sense's published picture as `image: { url, sentence }`
(`sentence` null for a picture of the sense); a picture of an example shows only
while a published example links that sentence to the sense. The entry's
`image` is the picture of its first sense in inventory order that has one, with
its `sense_id`, and every summary gives its picture's `image_url`: a word
summary the entry's, a sense summary the sense's.

### Write rules

Submissions (`POST /manage/v1/facts`) enforce
these formats in `shared/facts.ts`. A violation is `400 invalid_request` whose
message names each rule the payload breaks. Stored facts are read with the
plain payload shape, so facts written before a rule still read.

- **Gloss** (each sense of an inventory). 6 to 300 characters after trimming. It starts with a capital
  letter, a digit, a quote, or `(`, and ends with a period. It holds no
  example: no `as in`, `e.g.`, `for example`, or `for instance`, and no quoted
  sentence (a quoted span that ends in `.`, `!`, or `?`). Examples are
  `example` facts. Quoted single words or set phrases, such as "usually
  followed by 'for'", are usage notes and pass.
- **IPA.** One broad transcription: no commas, semicolons, slashes, brackets,
  parentheses, or `|`. Each symbol is from the broad English IPA set
  (`aeiouæɑɒɐɔəɛɜɪʊʌɨɵʉ`, `bdfhjklmnprstvwzðθʃʒŋɡʔɾɫʍxç`, `ˈ ˌ ː ˑ`,
  space, and `ʰ ʷ ᵊ`, syllabic, non-syllabic, nasal, and tie marks). The
  house style is the Oxford learner's dictionaries': one spelling per sound
  keeps transcriptions comparable: `r`, not `ɹ`; `ɡ`, not `g`; `ˈ` and `ː`, not
  `'` and `:`; `tʃ` and `dʒ`, not ligatures; `ər` and `ɜːr`, not the
  r-coloured `ɚ` and `ɝ` (`ə` and `ɜː` in British); and no syllable dots
  (`.`). An American transcription (a pronunciation or form with `accent: us`)
  writes the vowel of *bed* as `e`, not `ɛ` (*care* is `ker`). The message
  names each symbol to replace: `An ipa uses broad English IPA symbols only;
  replace "." (write nothing: no syllable dots), "ɚ" (write ər in American, ə
  in British).`, and `An American ipa writes the vowel of "bed" as e, not ɛ
  ("bed" is bed, "care" is ker), as learner's dictionaries do.`

- **Translation.** `language` is a served language (`SERVED_LANGUAGES` in
  `shared/facts.ts`, now only `zh`, which is Simplified Chinese), so the
  worklist gap it fills and the language reads serve are the same tag; the
  submit schema is an enum of them, which the OpenAPI document lists, and the
  message names the served languages; `of` names what it translates. A zh
  text uses fullwidth punctuation: `A zh text uses fullwidth punctuation:
  write ； ， （ ） in place of ASCII ; , ( ).` A translation's alternatives are
  separated by `；`, each once: `A translation lists each alternative once:
  "建造；建造" repeats one.`
- **Form.** A labelled inflection names a part of speech its type can be shown
  under (`carriers` in the registry: a plural a noun, pronoun, or determiner;
  a past, participle, or third-person form a verb or auxiliary; a comparative or
  superlative an adjective, adverb, or determiner); a labelled variant may name
  any. A periphrastic comparison (`isPeriphrastic`: a comparative spelled
  `more …` or a superlative spelled `most …`) is not an inflection, so it is
  never a form: `"more beautiful" is a periphrastic comparative form, made with
  more or most; it is not an inflection, so it is never a form. Record only an
  inflected comparative form ("bigger", "biggest", "better"); a word compared
  only with more and most has no comparative form.` Anything else is
  `422 invalid_reference`.
- **Grammar.** At least one property, each pattern once, and one to four
  prepositions, each once.
- **Word formation.** Parts in written order: prefixes, then at least one base,
  then suffixes. A submission names no `root` part: a word formation is
  synchronic, so a word not built on a present-day English word is a simple word
  (`"port" is a root; a part is a present-day English word (base), a prefix, or a
  suffix. A word not built on a present-day English word is a simple word: one
  base part, the word itself ("important", "factory").`); stored formations with
  a root still read. A prefix is letters ending in a hyphen (`un-`), a suffix a
  hyphen followed by letters (`-ness`), and a base a
  word (`happy`, or one with an inner hyphen, apostrophe, or period, and an
  abbreviation's final period: `o'clock`, `a.m.`, `Mrs.`). One part is a simple
  word, so its role is `base`; an abbreviation or contraction is one base. A
  formation with `shortened` is one base part without a lemma (`A shortened word
  is one base part, the word itself, without a lemma; "mistress" goes in
  shortened.of only.`).
- **Collocation.** At least two words.
- **Relation ends** (`admitEnds`, `422 invalid_reference`). A relation links
  common, current senses: its target, and for a symmetric type (synonym,
  antonym) either end, may not be ranked extra in its entry's current inventory
  (rare, archaic, technical, or specialist), except the target of a domain
  hypernym, a specialist term that is often an extra sense of its word
  ("canine" as a zoological family), nor be labelled `dated`. The rule reads
  both ends' inventories before the write, at submission and when a rejected
  relation is re-reviewed back to life.
- **Inventory.** At least one common sense, the common senses before the extra
  ones, and each existing sense named once.
- **Phrases.** Each phrase has at least two words and is listed once, in any
  letter case.

#### Grammar, word formation, and collocations

`grammar` is what a learner needs to use a sense in a sentence. Its properties
depend on the sense's part of speech, which a submission is checked against:

| Part of speech | Properties                                                         |
| -------------- | ------------------------------------------------------------------ |
| noun           | `countability` (required unless `number` is `plural_only`): `countable`, `uncountable`, or `both`; `number`: `singular_only` ("a while", "the sun") or `plural_only` ("jeans", "trousers"), which stands in place of countability; `article`: `with_the` ("the internet") or `zero_article` ("in hospital", "by car"); `patterns`; `prepositions` |
| verb           | `transitivity` (required): `transitive`, `intransitive`, or `both`; `patterns`; `prepositions` |
| adjective      | `position`: `attributive_only`, `predicative_only`, or `both` (absent means not stated); `patterns`; `prepositions` |
| adverb         | `position`, the usual one: `front` ("Suddenly, …"), `mid` ("I usually walk", "She has just left"), or `end` ("He works hard"); `prepositions` |
| determiner, pronoun | `agreement` (required), one to four of: `singular_noun` ("each day"), `plural_noun` ("many books"), `uncountable_noun` ("much time"), `of_plural` ("each of the boys"), `singular_verb` ("everybody is"), `plural_verb` ("both are") |

`patterns` lists the common constructions that follow the word, not all of
them: `to_infinitive`, `bare_infinitive`, `ing_form`, `that_clause`,
`wh_clause`, `object_to_infinitive`, `object_bare_infinitive`, `object_ing`,
`two_objects`, and `object_complement` for verbs; adjectives take
`to_infinitive`, `ing_form`, `that_clause`, `wh_clause`, and `of_ing`
("afraid of falling"); nouns take `to_infinitive` ("a decision to leave"),
`that_clause` ("the fact that"), and `of_ing` ("the habit of smoking"). Each
pattern's parts of speech are those its illustration table names
(`grammarPatterns` in the registry). An adjective's position `both` lets every
adjective state its grammar ("a big house", "the house is big"), so the
adjective grammar gap is always fillable.

`prepositions` names the prepositions a learner uses after the word in this
sense, as learner's dictionaries write them ("rely on/upon sb/sth", "good at
sth"): `["on", "upon"]` for *rely*, `["at"]` for *good*. It holds one to four
values, each once, from a closed list of prepositions and adverb particles
(`DependentPreposition` in `shared/facts.ts`): `about`, `above`, `across`,
`after`, `against`, `along`, `among`, `around`, `as`, `at`, `before`, `behind`,
`below`, `beside`, `between`, `beyond`, `by`, `down`, `for`, `from`, `in`,
`into`, `like`, `near`, `of`, `off`, `on`, `onto`, `out`, `out of`, `over`,
`past`, `round`, `through`, `to`, `toward`, `towards`, `under`, `up`, `upon`,
`with`, `within`, and `without`. Time adjuncts such as *during*, *since*, and
*until* are never selected by a word, so they are not listed. A noun names
the prepositions it takes in its grammar too ("an increase in", "interest in"),
beside its required countability; its `number` and `article` say what a
learner's dictionary marks [sing.], [pl.], or "the …" / "in hospital". A
plural-only noun (*jeans*, *trousers*, *scissors*) is marked [plural] in place
of [C] or [U]: it takes no "a" and has no singular, so no countability is true
of it, and review rejected every one tried for *jeans*. Its grammar names
`number: plural_only` and no countability (`standsIn` on the noun rule in the
registry); one naming both is `422 invalid_reference` ("For a plural-only noun
("jeans", "scissors"), number plural_only takes the place of countability;
remove countability."). Its grammar names no countable sense, so the entry has
no plural slot. A title used before a name (*Mr*, *Mrs*, *Dr*) has no grammar a learner's
dictionary prints, so a pass completes its optional grammar slot with
`found_none` (see Passes).
Grammar about any other part of speech (number, preposition, conjunction,
interjection, auxiliary) is refused by the registry's
`subjectPos`, as a topic on a function word is. A property the part of speech
does not take, a missing required one, a pattern it does not take, or a
position of the other part of speech (an adjective's `both` on an adverb,
`mid` on an adjective) is `422 invalid_reference` with a message naming what
to change ("both is not a position of an adverb; its positions are front, mid,
end."). Its content key is its properties in a fixed order with sorted
agreement, patterns, and prepositions.

`morphology` is an entry's word formation as a learner's dictionary gives it:
a simple word is one `base` part (`water`), and a derived word names its base and
affixes (`unhappiness` = `un-` + `happy` + `-ness`). It follows one synchronic
rule: a word has parts only when it is built on a present-day English word
whose meaning it takes; every other word, a loan or a historically opaque word,
is a simple word (`important`, `factory`, `business`). Roles are `prefix`,
`suffix`, and `base`; `root` (a bound Latin or Greek stem, `spect`) is read from
stored formations only and refused on submission. A word made from another
word without an affix is one base part, the word itself, naming that word by
`lemma`: a conversion with a spelling change (`shelve` = `shelve` (base, lemma
`shelf`)) or a back-formation (`televise` = `televise` (base, lemma
`television`)), so the source word's family lists it. A phrase has no word formation: a
morphology fact about a multiword entry is `422 invalid_reference`. The check
of the parts is light: their letters, without hyphens, apostrophes, and periods and
ignoring case, must spell the lemma within two changed letters for each place
two parts join (`happy` + `-ness` gives *happiness*, `decide` + `-ion`
*decision*); otherwise it is `422`. Whether the parts are the real formation is
review's job: Jev is asked whether the word is formed from exactly these
parts by the synchronic rule, with the word's first senses in its state, and
its pass settles (with the rule in its question it passed every correct
formation and failed the etymological splits such as *consist* + *-ent*); the
LLM decides the rest. A `base` part may name the entry it is by `lemma`, exactly as the
entry spells it (`student` = `study` (base, lemma `study`) + `-ent`): that link
is what the base's word family reads (see Gaps). A lemma on any other role is
`400`; a lemma that is not a live entry's is `422 invalid_reference` ("\"glad\"
is not the lemma of a live entry; a base names an entry exactly as it is
spelled. Leave the lemma out, or name the word in blocked_on."), checked by the
registry's `references` hook before the write, and again when a rejected fact is
re-reviewed back to life; a base naming the word itself is refused by `admit`
("A base names the entry of another word the word is built on; \"study\" is
this entry, so leave its lemma out."). A shortened word states what it
shortens in `shortened`: `type` is `abbreviation` (*Mrs*, of *mistress*;
*a.m.*), `contraction` (*o'clock*, of *of the clock*), `clipping` (*phone*, of
*telephone*), or `blend` (*brunch*, of *breakfast and lunch*), and `of` is the
source written in full. Review rejected *Mrs* and *o'clock* as plain simple
words for not naming their source. `of` is text, not a link: it names no entry
and adds nothing to a word family. Its content key is each part's role,
form, meaning, and `=lemma` in order (`base:study|=study+suffix:-ent`), then
`|~type:of` for a shortened word (`base:mrs|~abbreviation:mistress`), so
adding a lemma or a source to a published formation is a correction. The public
entry's `morphology` carries `shortened` when the formation has one.

`collocation` is a combination native speakers commonly use with a sense, such
as *make a decision*: its meaning is plain from its words, and only the choice
of words is conventional (*heavy rain*, not *big rain*). A combination whose
meaning is not plain from its words or whose form is frozen (*in vain*, *a means
to an end*, *in the long run*) is a phrase: it belongs in the headword's phrases
list and gets an entry, and review fails it as a collocation. The `phrase`
pattern is a set combination with a preposition or determiner whose meaning is
plain (*by air*, *over the phone*). `pattern` is `verb_noun`, `adjective_noun`, `noun_noun`,
`adverb_adjective`, `verb_adverb`, `verb_preposition`, `noun_preposition`,
`adjective_preposition`, `phrase`, `subject_verb` (*the room spins*),
`verb_adjective` (*go bankrupt*, *squash flat*), or `passive` (*tormented by
guilt*); a verb with a particle after it is `verb_adverb` (*tack down*) and a
verb with a preposition and its noun `verb_preposition` (*return to one's
birthplace*), as the rubric and the write rules say. Published collocations
keep their pattern. Its text must contain the lemma, or the
form of one of the entry's live `form` facts, as whole words, case-insensitively
and with a typographic apostrophe (’ or ‘) matching a straight one; otherwise it
is `422 invalid_reference`, and the message tells the agent to use the word or
one of its recorded forms. A word with a fused clitic (`'s`, `'re`, `'ve`,
`'ll`, `'d`, `n't`) also reads as the word it is fused to: *let's see* contains
*let*, *don't* *do*, and *can't*, *won't*, and *shan't* *can*, *will*, and
*shall*. The auxiliaries *be*, *have*, and *do* are a closed class, so their
irregular forms (*am, is, are, was, were, been, being*; *has, had, having*;
*does, did, done, doing*) count as forms of the lemma whether or not they are
recorded as `form` facts. A sense holds at most five live collocations
(`maxLive` in the registry): a sixth is `409 conflict`, a resubmission of a live
one returns it, and a correction that supersedes one takes its place. The cap
is enforced as the topics limit is: inside the insert and the re-review reset,
so concurrent submissions cannot pass it. Its content key is the pattern and
the case-folded text with typographic apostrophes straightened, so *five
o’clock* and *five o'clock* are one collocation. The same text under two
patterns is two collocations.

The payload rules against the subject are the registry's `admit` hook, which
`subjectPos` cannot express because they read the payload: when a kind has one,
the submission loads what the rule reads (the lemma, a sense's part of speech, and
the entry's live forms) and runs it after the content-key dedupe, so
resubmitting a live fact still returns it. Re-reviewing a rejected fact runs the
same rule against the subject as it is then, because a live form the fact relied
on may have been retracted or rejected since: a fact that no longer fits answers
the same `422 invalid_reference` and stays rejected.

Labels are optional, and absent means unlabelled:

| Kind            | Label       | Values                                                                 |
| --------------- | ----------- | ---------------------------------------------------------------------- |
| `senses` (each sense) | `register`, `region` | register `informal`, `slang`, `taboo`, `literary`, `formal`, `dated`, `offensive`, `technical`; region `british`, `american`, `australian`, `new_zealand`, `canadian`, `irish`, `scottish`, `south_african`, `indian` |
| `form`          | `pos`       | The part of speech the form inflects: `would` is the `auxiliary` past of *will*, `willed` the `verb` past |
| `pronunciation` | `strength`  | `strong` (absent means strong) or `weak`, the unstressed form of a function word such as /tə/ for *to* |
| `pronunciation` | `pos`       | The part of speech a pronunciation belongs to, such as the noun *do* /doʊ/ |


A weak form must carry `strength: weak`; the LLM reviewer is told which form
it judges and rejects a weak form submitted as the strong one. A form's `pos`
replaces the word class in its Jev question and in the LLM rubric, so both
judge the labelled claim. A pronunciation's `pos` is named in its prompt, and a
sense's register and region in its inventory question ("used in a formal
register"), so a wrong label fails review. The public entry shows every label:
a sense's register in its `labels` and its `region`, a form under the meaning
of its part of speech, and a pronunciation's part of speech by listing it
under that meaning instead of the entry. A form's part of speech is part of its
content key (`type|form|pos`, and `type|form` unlabelled), so "would" labelled
auxiliary is a claim of its own beside the unlabelled past of "will":
relabelling a form is a correction that supersedes it. A pronunciation's labels
are not part of its key: the same transcription with another label returns the
live fact, and relabelling one means retracting it and submitting the labelled
fact.
### Fact lifecycle

```
           submit
             │
             ▼
         ┌────────┐  review fail              ┌──────────┐
         │pending │──────────────────────────▶│ rejected │
         └────────┘                           └──────────┘
             │ review pass/uncertain
             ▼
        ┌──────────┐ correction published     ┌────────────┐
        │published │─────────────────────────▶│ superseded │
        └──────────┘                          └────────────┘
             │ retract
             ▼
        ┌──────────┐
        │retracted │
        └──────────┘

(Retract also applies to pending facts. An admin's re-review returns a rejected
fact to pending. A curator's pass moves a pending or published fact to
published and its fail moves one to rejected; see Curation.)
```

The transition table lives in `server/domain/fact-lifecycle.ts`. Review writes
are conditional on `status = 'pending'`, so a duplicate queue delivery cannot
change a decided fact. A fact is reviewed once: nothing marks a published fact
for review in place. A correction (`supersedes_id`) is reviewed like any fact.
When it publishes, the superseded fact changes status in the same D1 batch: the
original leaves `published` first, and only while the correction is still
pending, then the correction enters it. A rejected correction leaves the
original published. A correction publishes even when its original left
`published` while it was pending (retracted); it then stands on its own and
retires nothing.

What a correction changes is visible on read, never rewritten. A fact about a
sense the published inventory no longer lists, or a translation of a
superseded example, stops showing and fills no slot; nothing retracts it.

An author can retract its own pending or published fact; admins can retract
any. An admin can re-review a rejected fact (`POST
/manage/v1/facts/{id}/rereview`): it returns to `pending` and is enqueued,
unless that would make a second live fact with the same content or in the same
slot. Re-reviewing a fact of any other status, a fact a live correction
supersedes, a rejected fact whose place another live fact took, or a rejected
correction whose original is no longer published or already has another live
correction answers `409 conflict`. The reset applies only to the status it
read, and every one of these rules is a condition of the reset `UPDATE`
itself, so none can race another write. Re-reviving a fact runs its write
rules against its subject as it is then.

Two invariants keep a correction in exactly its original's place. Each holds by
construction in a single statement, never by a read before the write; D1
runs statements one at a time, so no write can land between a check and the
write it guards.

- **I1. A live correction's original is published or has left live.** A
  correction enters `pending` only by its insert or by the re-review reset of a
  rejected correction. Both carry `EXISTS (original id = supersedes_id AND
  status = 'published')` in the same statement. An original that left live
  (superseded, retracted, or rejected) never comes back while its correction
  is live. A refused correction write is `409 conflict` with "Only a published
  fact can be superseded".
- **I2. A fact has at most one live correction.** The partial unique index
  `facts_live_correction_idx` on `supersedes_id` over live rows refuses a
  second one. A submission is `409 conflict` with "The fact this corrects
  already has a live correction", and so is re-reviewing a rejected correction
  beside a live one.

With both, a kind's `maxLive` limit holds for published facts. The insert and
the revival of a rejected fact count the live facts of the kind except the
fact being corrected. Each live correction has its own original (I2), and that
original is not counted only while it is published or out of live (I1). A
correction and its original are therefore never published together, and the
published facts of a kind never exceed the limit. The use cases still read the
original first and again after a refused write, but only to choose the
message.

### Submissions

`POST /manage/v1/facts` with `{ kind, subject_id, payload, supersedes_id?,
curation? }` runs, in order: the payload schema (`400`), the subject's node
type and the kind's parts of speech (`422`), the topic and target references,
the content-key dedupe (a live fact with the content returns it with `200` and
enqueues nothing), the rejection checks, the shown-sense checks, the kind's
`admit`, `references`, end, and link rules (`422`), the correction rules, and
then the insert, whose own statement enforces the slot, live-content, and
correction indexes (`409`). Only a new fact is enqueued for review.

- **Rejected before.** Content a review already rejected for the same kind
  and subject is refused with `409 rejected_before`, naming the rejected fact
  and its reason, without a new review: the producer fixes what the review
  named instead of resending it (one etymological split, *consist* + *-ent*,
  was rejected 625 times). Content a curator rejected is `403 curated_fact`.
  A curator may submit either again.
- **Inventory settled.** A `senses` fact for an entry with a published
  inventory is `403 inventory_settled` for anyone but a curator (see Sense
  inventory).
- **Shown senses.** A fact about a sense, and a relation's target, must name a
  sense that a published inventory of a live entry lists; otherwise `422
  invalid_reference` says to name the word in `blocked_on`.

### Reviews

- **Jev** gets typed `noul` questions and an object `state` at `POST
  {MODEL_BASE_URL}/v1/systemone` and returns a probability per question.
- **luna** is OpenAI's Decisions API (`POST {DECISIONS_BASE_URL}/v1/decisions`,
  model `DECISIONS_MODEL`, key `OPENAI_API_KEY`), reached directly rather than
  through the model gateway. Each question is a `predicate` scored with the
  probability of yes; the state is rendered as labelled text input. A refusal
  answers nothing and scores 0, leaving the fact to the LLM.
- **LLM** gets a rubric prompt at the OpenAI-compatible chat completions
  endpoint of the model gateway and must return JSON `{ verdict, confidence,
  reason }`. A picture goes with the prompt as an image part of the user
  message (see Pictures).

A decision model's **score** is its lowest answer: every question must hold. It
reads `pass` at its kind's threshold, `fail` below 0.5, and `uncertain` between
(`decisionOpinion` in `server/domain/review-chain.ts`); the threshold is 0.8
unless the kind sets its own (antonym 0.9, synonym 0.7, syllables 0.9, a
sense equivalent's Jev 0.9). Each plan says how its models combine
(`decisionSettles`): `min`, every model reaches its threshold; `any`, at least
one does (translations); `mean`, the mean score reaches the mean threshold
(topics). The chain is fixed and one-shot (`judge` in
`server/usecases/review.ts`):

1. The decision models the plan names are asked at once. When they settle, the
   fact publishes with a review naming every model asked (`jev`, `luna`,
   `jev+luna`), the highest score as its confidence, and every opinion.
2. Otherwise the LLM judges the same claim with the kind's rubric and decides:
   pass or uncertain publishes, fail rejects. The review names the whole chain
   (`jev+llm`, `jev+luna+llm`) with the LLM's verdict and confidence, and keeps
   every opinion. A kind without decision models goes to the LLM alone (`llm`).

The plan gives a decision model the rules a pass needs in its question, the
same rules the rubric holds, and the fact's data in its state, so the two
judge one standard. A plan whose context leaves nothing to judge, a fact about a
sense no live inventory lists or a topic that is no leaf, is `unreviewable` and
rejected without asking anyone. The review stores the context it judged
(lemmas and glosses of the referenced senses, the entry's senses) so a later
reader knows what was approved. A fact never waits for another fact: a
meaning-dependent fact is judged against its sense's gloss in the current
inventory, pending or published.

- **Proper nouns.** The inventory and phrases rubrics state one rule
  (`PROPER_NOUNS`): an established country, continent, nationality, language,
  people, religion, adherent, scripture, festival or holiday, day or month,
  major world city, or well-known geographical feature counts ("London", "New
  York", "the Pacific"); a personal name, a brand or company name, an
  organisation, or a minor place does not, nor does a proper noun as a sense of
  a spelling with other capitalization.
- **Examples** of vulgar, offensive, or derogatory senses are judged as
  illustrations of that sense: a sentence that shows the sense in ordinary use
  passes, and one that adds offence the sense does not need fails.
- **Relations** see both senses and the target entry's other senses, fail a
  relation whose type is not the most accurate one or whose target has a
  better-matching sense, and judge the relation between the words, not a detail
  one gloss mentions and the other omits (see Relations).
- Every model call is bounded by `GATEWAY_TIMEOUT_MS` (120 s), body included; a
  call that never answers once stalled every review for twenty minutes, so past
  the bound it is a transport failure. The bound is a deadline the call races,
  not only an abort signal handed to `fetch`: the local runtime let calls run
  past the signal, and one that never answered held its batch and the queue.
- A transport or protocol failure of any reviewer is not a verdict. The fact
  stays `pending`, the error propagates, and the queue retries the whole chain.
  There is no fallback reviewer.

The registry's thresholds started from the evaluations of 2026-11-11 (Jev and
Decisions reports) and are confirmed on a natural sample of snapshot data
before each change; audits adjust them.

## Tickets

Everything that needs a person is a **ticket** (`tickets` table,
`shared/tickets.ts`): a type, a target, a message, a status (`open`,
`resolved`, `dismissed`), and the resolution note and fact ids. A target has at
most one open ticket of each type (`tickets_open_target_idx`), so raising it
again finds the open one.

| Type | Target | Raised by |
| ---- | ------ | --------- |
| `stuck_work` | the entry or sense of a work item | the rescore, when a second pass leaves the item unfilled (see Passes) |
| `feedback` | an entry, sense, or fact | a reader's report (`POST /v1/feedback`) |
| `audit` | a fact | an audit pick of a low-credibility fact (see Scores) |
| `missing_word` | a lemma that is no entry | a curator collecting the words passes were blocked on |

- `GET /manage/v1/tickets?status=&type=&limit=&cursor=` pages tickets oldest
  first; `GET /manage/v1/tickets/{id}` reads one (`404` for an unknown id). Each
  carries `entry` (`{ id, lemma }`): the entry its target is or belongs to (a
  sense's entry, a fact's subject's entry, through an example for a
  translation), or null for a lemma.
- `POST /manage/v1/tickets/{id}/resolve` (curators) closes an open ticket:
  `{ resolution: "resolved", fact_ids, note }` names the facts that fixed it
  (each must exist, else `422`), and `{ resolution: "dismissed", note }` says
  why nothing needed fixing. A closed ticket is `409 conflict`; every write is a
  compare-and-set on the ticket's revision.
- `POST /manage/v1/entries/{id}/passes` (curators) with `{ type, subject_id,
  note }` settles a slot nothing can fill, required ones included ("main" has
  no -er comparative): it records a pass on the slot, so the slot counts as
  filled and its item closes; `204`, or `404` for an unknown entry.

### Feedback

Anyone can report a problem with an entry, a sense, or a fact through `POST
/v1/feedback` with `{ target_type, target_id, message }`. The target must be
publicly visible under the read rules; anything else is `404 not_found`. Each
client address (`CF-Connecting-IP`) may send 10 reports a minute through the
`FEEDBACK_RATE_LIMITER` binding; more is `429 rate_limited` with `Retry-After:
60`. A report opens a `feedback` ticket on its target, or returns the open one
(`201 { id, status }`). There is no feedback loop of its own: reports and stuck
work reach the same curators through the same list.

## Curation

The review rules only need to pass the great majority of facts. The words they
handle badly (titles like *Mrs*, contractions like *o'clock*, plural-only nouns
like *jeans*, conversions like *shelve*) and every ticket are handled by hand
instead of tuned for one by one. A **curator** is an admin, or an agent an
admin issued with the curator capability: `POST /manage/v1/agents` with `{
"name": "…", "curator": true }` stores `curator = 1` on the agent row and the
principal carries it. Producer agents are issued without it and get `403
forbidden` on every curator operation.

A curator's verdict replaces the reviewer chain's. It is recorded as the fact's
review with `reviewer: "curator"`, `model` the curator's principal ref
(`agent:…` or `admin:…`), the verdict, confidence 1, the curator's reason,
empty `context` and `detail`, and `reviewed_at`. A fact whose review names the
curator is **curated**.

- **Curated write.** `POST /manage/v1/facts` with `curation: { reason }` runs
  every submission rule, inserts the fact pending, and then writes the
  curator's pass through the `curate_pass` transition instead of enqueueing a
  review. A curated correction retires the fact it supersedes as a passing
  review would, a published inventory included: this is how a settled
  inventory changes. A submission whose content a live fact holds returns that
  fact unchanged with `200`. If the second write is lost, the reconcile cron
  sends the pending fact through the reviewer chain, so the write still
  converges.
- **Settle.** `POST /manage/v1/facts/{id}/curate` with `{ verdict, reason }`.
  `pass` publishes a pending or published fact (`curate_pass`), replacing its
  standing review. `fail` rejects a pending or published fact (`curate_fail`).
  Passing a rejected fact first revives it through the `rereview` reset, so it
  is `409 conflict` exactly when re-reviewing it would be. Any other status is
  `409 conflict`.
- **Final for the rules.** Only a curator may supersede or retract a curated
  fact, or resubmit content a curator rejected; anyone else gets `403
  curated_fact`.
- **Admission.** Curators admit headwords (`POST /manage/v1/entries`) and run
  the core import (admins), and settle slots and tickets (see Tickets).

A curated write or settle bumps the entry's worklist revision and rescores it
like any fact write, and a curated fact counts as a published one with
credibility 1. The audit boundary logs each of these `POST`s with the curator
as the actor. The public API is unchanged: its review metadata names no
reviewer.

## Work items

Agents ask the server what to work on instead of keeping their own list. The
unit of work is a **work item**: one open gap of a live entry or of one of its
senses (see Gaps). Facts are the unit of review, and items are the unit of
work, so cheap, valuable work never waits behind the rest of its entry, and
like decisions come together because a claim leases items of one type at a
time. Each item is leased, worked, and judged on its own; a lease keeps two
agents off the same item. An item gets at most two passes (`MAX_PASSES`): the
first, and one retry that sees the review reasons. Then it leaves the queue as
a ticket.

A type whose `WORK_POLICY` entry names a kind it `classifies` is worked by the
server itself, never handed to an agent (see Productive use): each scheduled
run, after its other steps, leases such items in queue order as
`system:classifier`, fifty at a time, for up to eight minutes, and completes
each lease with a pass per item noting what it published or why a write rule
refused it.

### Claim

`POST /manage/v1/work/claim` with `{ types?, limit?, lease_seconds? }` leases up
to `limit` items (1 to 50, default 10) of **one** type: the type of the
highest-priority free item of the production queue, among `types` when given,
then that type's next free items in priority order. `lease_seconds` is 60 to
3600, default 900. A body naming an unknown type, a type twice, an empty
`types`, or a limit or lease out of range is `400 invalid_request`; no body is
the defaults. It answers `204` when no item is free:

```json
{
  "lease": { "id": "…", "type": "category", "holder": "agent:…", "expires_at": "…" },
  "items": [
    {
      "id": "…", "type": "category", "entry_id": "…", "lemma": "eagle", "subject_id": "<sense id>",
      "stage": 2, "attempts": 0,
      "gap": { "type": "category", "sense_id": "…" },
      "context": {
        "entry": { "id": "…", "lemma": "eagle", "cefr": [{ "pos": "noun", "level": "B1" }], "zipf": 4.1,
                   "senses": [{ "id": "…", "pos": "noun", "gloss": "…", "register": null, "region": null,
                                "rare": false, "status": "published" }] },
        "sense": { "id": "…", "pos": "noun", "gloss": "A large bird of prey.", "…": "…" },
        "facts": ["Fact, in every status with its review"],
        "rejections": ["Fact an earlier pass submitted that review rejected, with its review"],
        "related": [{ "sense_id": "…", "lemma": "bird", "pos": "noun", "gloss": "…" }],
        "view": null,
        "criteria": {
          "fills": [{ "kind": "relation", "claim": "relation hypernym (everyday layer, no domain)",
                      "decision": { "models": ["jev"], "questions": ["…"], "rule": "…" },
                      "rubric": "Is this relation between two English word senses correct, …",
                      "limits": ["A relation links common, current senses: …"] }],
          "limits": ["Only a published fact can be superseded: …"]
        }
      }
    }
  ]
}
```

`subject_id` is the node the item is about: the entry or a sense. The context
is what a worker needs without another read (`workContext` in
`server/domain/work-context.ts`): the entry with its level, frequency, and the
senses of its current inventory in order (each marked rare when ranked extra,
with the inventory's status), the sense the item is about (null for an entry
item), every fact about the item's node in every status with its review, the
item's `rejections` (up to ten rejected facts of the kinds that fill it, newest
first, so a retry addresses each reason and never resubmits rejected content),
the senses at the other end of its relations (`related`; `gloss` is null when
that sense cannot show, so a relation to it fills nothing), and, for the types
that read every sense at once (`senses`, `phrases`, `family`, `translations`,
`sayings`), the entry's whole management view as `GET /manage/v1/entries/{lemma}`
returns it. Wherever a view or a context shows a fact, an example carries its
sentence's text beside its id (`{ sentence_id, text }`) and each phrases item
its lemma or text (`{ type, entry_id, text, sense_id? }`, `{ type: "saying",
sentence_id, text }`), so a producer reads every translation target and keeps
a list's items without another read; the view also lists the facts about the
entry's sentences (their translations and meanings) and its `phrase_type`. The
stored payloads hold ids only, and `text` is never part of a content key.

`criteria` (`workCriteria` in `server/domain/work-criteria.ts`) makes the
server the one source of what passes: for each kind of fact that fills the
item's gap it gives the decision models asked, their exact questions and how
their scores settle a pass (`decision`, null for an LLM-only kind), the exact
LLM rubric, and the kind's write rules, and every item carries the write rules
every submission meets (`GENERAL_LIMITS`). The prompts are the plans the
reviews build (`planReview`), rendered for placeholder values (`<word>`, `<the
gloss of the sense>`) and the item's part of speech, so they are the standard
itself, not a copy that can drift and not an answer to echo. A topics item
lists the taxonomy.

The claim is two statements. The first reads the type of the first free item in
queue order (`nextTypeStatement`, a walk of `work_items_queue_idx`); the second
leases that type's first `limit` free items in one `UPDATE … WHERE id IN (SELECT
… ORDER BY rank, zipf_order DESC, created_at, id LIMIT ?) RETURNING`
(`leaseStatement`, a range of `work_items_type_queue_idx`) and records the gap
each was claimed with. D1 runs statements one at a time, so two concurrent
claims never lease the same item; an item whose lease expired is free. The
lease row (`work_leases`) records the holder, the type, and the items and
entries it leased.

### Complete

`POST /manage/v1/work/{lease_id}/complete` with `{ items: [{ id, note?,
found_none?, blocked_on? }] }` (notes up to 500 characters) ends the pass. The
items named were worked; the lease's other items are released without an
attempt. Only the holder completes, and only before `expires_at`: another
principal or an expired lease is `409 conflict`, a lease that is gone `404
not_found` (so a second complete is 404), and an item the lease did not claim
`422 invalid_reference`. `found_none` without a `note`, or `found_none` or
`blocked_on` on an item of a required gap, is `400 invalid_request`. In one
batch, while the lease is still held, it marks the named items worked with the
note, the holder, and `found_none`, records each `blocked_on` lemma
(`work_pass_blocks`), releases every item of the lease, bumps the revision of
the lease's entries and stamps their `last_worked_at`, and deletes the lease;
then it rescores those entries and answers where each named item stands. The
same batch records an **attempt** per named item in `work_attempts`: the
holder, the lease, its `claimed_at`, the completion time, the lease's seconds
divided by the number of items named, and the note:

```json
{ "lease_id": "…", "items": [{ "id": "…", "state": "awaiting_review", "attempts": 0 }] }
```

`closed`: the gap is gone, or an optional slot had its pass. `open`: back in
the production queue. `awaiting_review`: a pending fact may change it, so its
verdict waits for that review. `ticket`: two passes left it unfilled. An
expired lease is kept a day (`EXPIRED_LEASE_RETENTION_MS`), so a holder that
completes late learns that it expired; the cron then deletes it.

### Passes

Gaps are **required** or **optional** (`OPTIONAL_GAPS` in `shared/work.ts`).

- Required: `senses`, `forms`, `pronunciation`, `form_pronunciations`,
  `morphology`, `syllables`, `examples`, `translations`. The item stays open
  until facts fill it.
- Optional: `phrases`, `family`, `category`, `parts`, `synonyms`, `topics`,
  `grammar`, `collocations`. One honest pass completes the slot: a producer
  submits every value a learner's dictionary gives, and when none fits it
  completes the item with `found_none: true` and a note naming what it
  considered and why none fits, submitting nothing. `blocked_on` (up to 20
  lemmas) lists words that would fit but are not live entries or have no
  published inventory yet.

When the rescore judges a worked optional item whose pass found none, it
records the slot in `work_passes` (`(type, subject_id)`, with the note and the
holder) and closes the item; a passed slot counts as filled from then on and
has no gap. A pass is no fact and goes to no reviewer; it lowers the entry's
credibility instead, so audits reach it (see Scores). Admitting a headword
(`createEntry`, the core import) deletes every pass blocked on that lemma and
its blocks (`reopenBlocked`) and bumps those entries, so the slot opens again
and a producer adds the newly possible value. A curator's settled slot is a
pass of any type.

**Progress.** A completed pass made progress only if the item's gap needs
fewer facts once its reviews settled than when it was claimed (`missingOf`):
a fact retracted and resubmitted, or the same claim reworded, is no progress.
Progress resets the attempts; otherwise the pass counts one. While a pending
fact may change the gap the item awaits review (`awaiting`), keeps its
attempts, and is not served; its verdict is drawn when the reviews land. A
resubmission of rejected content never reaches review (`409 rejected_before`),
so it cannot buy another pass. The second pass that leaves an item unfilled is
`stuck`: the item leaves the production queue (`attempts >= MAX_PASSES`) and
the same batch opens a `stuck_work` ticket on its node whose message names the
type and the last note. A curator's fact or settled slot closes it; any change
to its gap starts its attempts over. The rescore's verdicts are `closed`,
`passed`, `progressed`, `no_progress`, and `stuck` (`reconcileItems` in
`server/domain/work.ts`); the second pass's success rate was 45% and a third's
36%, so a third pass is not worth its cost.

### Priority

`WORK_POLICY` in `server/domain/work.ts` is the one table of what each type of
work is worth and what context it needs; nothing else branches on a type.
`workPriority` ranks an item by its entry's headword **batch**, then the
**learner band** of its entry; the queue then takes the entry's Zipf frequency,
highest first (`zipf_order`, -1 without one), then the type's **stage**, then
age and id. A later batch waits for the earlier one; a phrase queues with its
headword's batch. Within a band the producers work entry by entry, the more
frequent word first, so whole entries finish one after another instead of every
entry standing half done; an entry's stages order its own work, and while its
next stage waits on a review the workers move on to the next entry:

| Stage | Types | Why |
| ----- | ----- | --- |
| 1 identity | `senses` | Nothing else can be judged before the inventory exists, and relations need their ends' inventories |
| 2 network | `category`, `parts`, `synonyms`, `family`, `phrases`, `topics` | Where the word sits among other words |
| 3 translation | `translations` | What the word means to a learner in each served language |
| 4 usage | `examples`, `grammar`, `collocations`, `forms`, `pronunciation`, `syllables`, `morphology`, `form_pronunciations`, `productive_use` | How the word is used |

The band is the entry's lowest CEFR level, A1 to C2 (0 to 5), then an entry
without a level, most phrases among them (6) (`learnerBand`). `rank` is the
batch times the band count plus the band. An import re-ranks the items with the
worklist (`rankWorkItemsSql`).

### Scores

`assessEntry` scores an entry from its facts and passes.

- **Completeness** is the filled share of the slots its gaps count: the
  inventory, each paradigm form, a strong pronunciation in `us` and `uk`, each
  irregular form's pronunciation, and for a single word its phrases list, word
  formation, and syllables (and its family at A1 and A2); one productive use
  per part of speech of its common senses; per common sense the
  slots of its scope (below); and per served language one translation per
  common sense, current example, and live collocation. A passed slot counts as
  filled. 1 means no gaps. Until the inventory exists the inventory is the only
  slot.
- **Credibility** replaces the earlier quality score. A published fact is as
  credible as facts of its kind settled by its review path are measured right
  (`factCredibility` in `server/domain/credibility.ts`): a curator's is 1, a
  decision model's own pass 0.97 (it held 35 of 35 audited facts), the LLM over
  a decision model that did not settle 0.88 (46 of 52), and the LLM alone the
  rate measured for its kind against hand labels (0.7 for an inventory to 0.99
  for a word formation). An optional slot passed without a value claims the
  slot is empty, which nobody reviewed, and counts 0.8. The entry's
  credibility is the lowest of these, 1 with none. Audits pick facts by low
  credibility times high frequency and raise `audit` tickets, and their
  results update the table.
- **Slots** split into those published facts fill (or a pass completed) and
  those only pending facts fill; the published count never exceeds what the
  live facts fill.

**Core senses.** A learner's dictionary gives the first few senses of a word
their full treatment, and a sense beyond them its examples and grammar. The
core senses are the first three common senses of the inventory and the first
common sense of each part of speech those leave out (`coreSenses`). A core
sense needs every per-sense slot its part of speech takes; another common
sense needs only its examples and grammar (each still has its translation); an
extra sense nothing.

### Gaps

A live entry's gaps (`entryGaps`) are computed from its facts in every status,
the inventories at the other end of its relations, the lemmas of its word
family, and its passes. A gap is open while fewer live facts fill it than it
needs and no pass completed it. Entry gaps:

- `senses`: no live inventory. While it is open it is the entry's only gap.
- `forms`: the paradigm a single word needs, by the parts of speech of its
  common senses: a verb's four forms, a countable noun's plural (its grammar
  names a countable sense), and the comparative and superlative of an
  adjective of one syllable, of two ending in y, or with a recorded inflected
  comparison, and of an adverb with a recorded one. A form fills a slot by its
  label or, unlabelled, by the meaning it shows under; a periphrastic
  comparison fills nothing. A phrase, an uncountable noun, and an invariable
  word need none.
- `pronunciation`: each of `us` and `uk` with no live strong pronunciation.
- `form_pronunciations`: each live irregular form with no live pronunciation.
- `phrases`: a single word with an inventory and no live phrases list.
- `family`: an A1 or A2 single word that no live entry's live word formation
  names as a base.
- `morphology`, `syllables`: a single word without one.
- `translations`, one per served language: each common sense, the sentence of
  each of its current examples (a pending correction stands for its original;
  a sentence several examples share is one slot), each live collocation, and
  on a headword each saying of its published phrases list, with no live
  translation in the language, by `of` (`sense`, `sentence`, `collocation`) and
  id. A sentence shared by several entries is one translation: whichever
  entry's pass fills it, it is filled for all.
- `sayings` (required, stage 3, entry context): each saying of the headword's
  published phrases list with no live `sentence_meaning`, as
  `{ type: "sayings", missing: [sentence_id] }`.
- `productive_use` (required, stage 4, entry context, classified by the
  server): each part of speech of the common senses with no live productive
  use, in inventory order, as `{ type: "productive_use", missing: [pos] }`;
  single words and phrases alike.

Sense gaps, per common sense of the current inventory, within its scope:

| Gap | Scope | Need |
| --- | ----- | ---- |
| `category` | core | a noun: one everyday hypernym to a sense that can show |
| `parts` | core | a noun with an everyday category: one `part_of` attached to it |
| `synonyms` | core | a noun, verb, adjective, or adverb: one synonym or antonym in either direction, or a hypernym (any layer) to a sense that can show |
| `topics` | core | a noun or verb: one topic |
| `collocations` | core | a noun, verb, adjective, adverb, determiner, preposition, or conjunction: one collocation |
| `examples` | common | two for a core sense of an A1 or A2 entry, else one |
| `grammar` | common | a noun, verb, adjective, adverb, determiner, or pronoun: one grammar fact |

A relation fills a slot only while the sense at its other end is listed by the
current inventory of a live entry (`visibleNeighbors`). A number sense needs
its examples and translation and none of the usage slots. A producer still
submits every real synonym and antonym; a hypernym only stops a sense with none
from staying open.

A **phrase entry** has the slots of its phrase type (see Headwords and
phrases); a multiword entry no published list types keeps every slot:

| Slot | phrasal_verb | compound | idiom | fixed_phrase |
| ---- | ------------ | -------- | ----- | ------------ |
| senses, examples, translations, synonyms, productive_use | ✓ | ✓ | ✓ | ✓ |
| category, parts, topics | – | ✓ | – | – |
| grammar | ✓ (paused) | – | – | – |
| pronunciation, collocations | – | – | – | – |
| forms, syllables, morphology, phrases, family | – | – | – | – |

Facts already published for a slot a type no longer needs stay; they no longer
count. Each piece of open
work is compared with the same computation over the published facts alone:
where they differ a pending fact may still change it, so it awaits review.

### The worklist and work item tables

`worklist` holds one row per entry:

| Column                                            | Meaning                                                    |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `entry_id`, `created_at`                          | The entry and its creation time                            |
| `live`, `batch`                                   | The entry is admitted, and the headword batch it belongs to (a phrase takes its headword's) |
| `frequency_key`                                   | `frequencyKey` of the lemma, written with the row          |
| `level_rank`, `zipf`                              | The learner priority: 1 (A1) to 6 (C2) for the lowest CEFR level of the exact lemma, and the Zipf frequency of `frequency_key`; null when the reference data has none |
| `completeness`, `credibility`                     | The scores, as of `scored_revision`                        |
| `slots_total`, `slots_published`, `slots_pending` | The slot counts, as of `scored_revision`                   |
| `revision`, `scored_revision`                     | Bumped by every write that can change the entry's work or public view; the revision the scores and items describe |
| `view_revision`                                   | The revision the entry's public view rows describe         |
| `last_worked_at`                                  | When a pass over one of its items last completed           |

`work_items` holds one row per piece of open work:

| Column | Meaning |
| ------ | ------- |
| `id` | The item; kept while its gap stays open, however it changes |
| `entry_id`, `type`, `subject_id` | The entry, the work type, and the node it is about; `(type, subject_id)` is unique |
| `gap` | The gap as the wire shows it, JSON |
| `stage`, `rank`, `zipf_order` | The policy stage, the queue rank, and the entry's Zipf frequency (-1 without one) |
| `awaiting` | A pending fact changes the gap, so it is not served |
| `attempts`, `worked`, `found_none`, `claimed_gap` | Completed passes that did not fill it; a completed pass whose verdict waits for a review; that pass found none; the gap at the last claim |
| `lease_id`, `lease_holder`, `lease_expires_at` | The current or last lease; all set or all null |
| `last_worked_at`, `last_worked_by`, `last_note` | The last completed pass over it |
| `created_at` | When the item opened |

The production queue is the items with `awaiting = 0 and attempts < 2`, in the
partial indexes `work_items_queue_idx` `(rank, zipf_order DESC, created_at, id)`
and `work_items_type_queue_idx` (the same, led by `type`). `work_passes` holds
the passed slots and `work_pass_blocks` the lemmas they were blocked on.
`work_leases` holds one row per lease, deleted by its completion or a day after
it expires. `work_item_log` keeps one row per item ever opened (its latest gap,
`created_at`, `closed_at`), and `work_attempts` one row per item a completion
named, with its `outcome` (`waiting_on_review`, `closed`, `passed`,
`progressed`, `no_progress`, `stuck`) and `settled_at`.

Every write that can change an entry's gaps or public view bumps `revision` of
the entries it touches in its own batch: a fact insert or status change, a
sense insert, an admission, a pass, and a completion. An inventory's insert or
status change also bumps the entries whose relations link to its senses, and a
word formation's the bases it names. The use case that made the write then
rescores the stale rows it touched, linked entries included, and rebuilds their
public views (`refreshEntries`). The rescore loads the entry and its stored
items, assesses it, reconciles the items with its open work, and writes the
scores, the upserted items, the passes, the stuck tickets, the deletion of
closed items, and the attempt verdicts in one batch, each statement conditional
on `revision` being unchanged, so a concurrent write's rescore wins instead of
being overwritten. A stale row keeps its items as of its last rescore until a
rescore reaches it; the cron rescores up to 100 stale rows a run
(`refreshStaleWork`), and `POST /manage/v1/work/rescore` (admins, `{ limit }`
1 to 200) drains them faster after a release that changes the gap rules,
returning `{ rescored, remaining }`.

### Monitor reads

The console reads how the work is going through admin-only endpoints (agents get
`403 forbidden`); nothing here writes, and every number derives from stored rows
on read. An open item **stands** (`openItemStatus`) `stuck` at `MAX_PASSES`,
else `in_progress` under an unexpired lease, else `waiting_on_review` while it
awaits review, else `queued`; a closed item is `closed`.

- `GET /manage/v1/work/summary?window=24h|7d` (default `24h`): open items by
  status, overall and per type (with its stage); `history_since`; the items
  created and closed in each hour or UTC day of the window; the median seconds
  from created to closed; per type the items closed, the median attempt
  seconds, and the success rate (closed, passed, or progressed over settled
  attempts); the distinct holders of unexpired leases; the forecast (net items
  closed per day over the last 7 days and 24 hours, overall and per lowest CEFR
  level, null while less than a day is recorded); and at most 100 recent leases,
  each with its first three lemmas and whether it timed out.
- `GET /manage/v1/work/attempts?outcome=&type=&holder=&lemma=&limit=&cursor=`:
  attempts, latest completion first, each with its ordinal among every attempt
  at its item, its entry, and the facts the holder authored between the claim
  and the completion about the item's node, each with a one-line `summary`.
  `lemma` is exact.
- `GET /manage/v1/work/items?entry_id=` or `?subject_id=` (exactly one, else
  `400 invalid_request`): the open items of the entry, or about one node, in
  queue order, each with its status, the lease while unexpired, and the gloss.
- `GET /manage/v1/work/items/{id}`: one item, open or closed, with every
  attempt, `agent_seconds`, and `queue_seconds`. An unknown id is `404`.

`GET /manage/v1/stats` counts facts by kind and status; published facts of low
credibility by kind (a review path right less than nine times in ten); live
facts; the average stored completeness of the live entries overall and per
lowest CEFR level with how many are complete; the pending facts, the oldest
one's creation, and how many have waited over an hour; tickets by status; and
the open items, the stuck ones, and the leases that timed out in the last 24
hours.

`GET /manage/v1/entries` gives each entry whether it is live, its inventory
size, its lowest CEFR level, its stored `completeness`, `credibility`, and slot
counts, and its open items by status, and filters by `prefix`, `level`, and
`stuck=true` (an item at `MAX_PASSES`). Each filter is an `EXISTS` through an
index per entry the lemma order reaches.

## Reference data

Word frequency and CEFR level come from external datasets, not from agents.
They are reference data with provenance: not facts, never reviewed, never part
of completeness or credibility. An admin imports them offline; the Worker only
reads them. They rank the work (see Priority) and choose the headword batches
(see Headwords and phrases); a reimport does not reopen decided reviews.

| Table               | Columns                                                    | Key            |
| ------------------- | ---------------------------------------------------------- | -------------- |
| `reference_sources` | `id`, `name`, `version`, `license`, `license_url`, `changes`, `attribution`, `url`, `retrieved_at` | `id` |
| `word_frequency`    | `word`, `zipf`, `rank`, `source_id`                        | `word`         |
| `lemma_cefr`        | `lemma`, `pos`, `level` (`A1`–`C2`), `source_id`           | `(lemma, pos)` |

The tables are keyed by spelling and do not reference `entries`, so an import
never depends on which entries exist. Each lemma has exactly one key per table,
and nothing is retried under another spelling:

- **CEFR** is read by the exact lemma, because case distinguishes the words the
  profiles list (`May` the month, `may` the auxiliary).
- **Frequency** is read by `frequencyKey(lemma)` in `server/domain/reference.ts`:
  the lowercase spelling. wordfreq case-folds every form it counts, so its key
  space is case-insensitive, and the value is the frequency of the
  case-insensitive word form, shared by every capitalization (`May` and `may`
  get the same frequency). JavaScript's `toLowerCase` stands in for Python's
  `casefold`; they differ only outside English (`ß` folds to `ss`).
- Multiword and hyphenated lemmas never have a frequency: wordfreq counts single
  tokens and splits words on hyphens.

`frequency` is null when wordfreq does not list the word form at all; there is
no Zipf cut, so null never means "listed but rare".

`GET /manage/v1/entries/{lemma}` carries `frequency: { zipf, rank, source_id } |
null` and `cefr: [{ pos, level, source_id }]`. The public entry carries
`frequency: { zipf, rank } | null`, each meaning the `cefr` level of its part of
speech, and summaries the lemma's lowest level; sources are named only by
`GET /v1/sources`. `GET /v1/sources` and `GET /manage/v1/sources` list every source
with its license, the license URL, the changes Vocnet made to its data, and the
attribution to show with it. wordfreq and Octanove are CC BY-SA 4.0, so their
data is shown with attribution, the license link, and a statement of the
changes ("Filtered and ranked by Vocnet: …").

Sources (`scripts/reference/sources.json` pins versions and checksums;
`scripts/reference/requirements.txt` pins every Python package of the export
with hashes):

- **Frequency**: wordfreq 3.1.1 `large_en` (CC BY-SA 4.0, Robyn Speer; contains
  SUBTLEX, OpenSubtitles, and Google Books Ngrams data). `zipf` is wordfreq's
  Zipf value of the form; the list stops at 1.01. Every one-token form of
  letters, combining marks, apostrophes, and periods is imported (313,560 of
  321,180 forms); markup and handles such as `info@`, `cs:go`, and `size_t` are
  not. `rank` is one plus the number of imported forms with a higher Zipf, so
  ties share a rank.
- **CEFR A1–B2**: CEFR-J Wordlist 1.6 (Yukio Tono, TUFS; commercial use with
  citation). **CEFR C1–C2**: Octanove Vocabulary Profile C1/C2 1.0 (CC BY-SA
  4.0).

The import rules live in `server/domain/reference.ts`. CEFR-J parts of speech
map one to one, except that modal auxiliaries and the be, do, and have verbs
become `auxiliary`, numbers become `number`, and infinitive "to" is dropped. CEFR-J lists
every form of be, do, and have as a row of its own ("'m", "'re", "'s", "am",
"is", "are", "was", "were", "been", "being", "does", "did", "doing", "done",
"has", "had", "having"); entries are lemmas and an inflection is a `form` fact
on its lemma's entry, so under these three labels only "be", "do", and "have"
are kept and the other rows are dropped. `build.mjs` counts and lists the
dropped forms. Modal auxiliaries ("can", "would", "have to", "used to") are
lemmas and are kept, as is the same spelling under another part of speech
("being", noun). Octanove's
`vern` is `verb`; its one unlabeled row is dropped. A headword listing variants
with `/` gives one lemma per variant. CEFR-J wins over Octanove for the same
lemma and part of speech, and a pair listed several times in one profile (once
per sense) keeps its lowest level. An unknown label or level fails the import.

An import replaces all reference data: the generated SQL deletes every
reference row, removes sources it no longer carries, upserts its sources, and
inserts its rows, so applying it twice changes nothing. It is applied with
`wrangler d1 execute`, not as a migration, because the data is about 17 MB of
SQL and changes on its own schedule. The generated files are not committed;
the pinned manifest reproduces them.

```sh
python3.13 -m venv .reference/venv
.reference/venv/bin/pip install --require-hashes -r scripts/reference/requirements.txt
.reference/venv/bin/python -I scripts/reference/export.py .reference/downloads > .reference/raw.json
node scripts/reference/build.mjs .reference/raw.json > .reference/reference.sql
pnpm exec wrangler d1 execute vocnet --local --file .reference/reference.sql   # or --remote
```

Whether a remote `--file` import is applied atomically is unverified. After a
remote import, compare `select count(*)` of `word_frequency`, `lemma_cefr`, and
`reference_sources` with the counts `build.mjs` prints, and rerun the import if
they differ.

On a copy of the development database (5,882 entries) the local import of
313,560 frequency and 9,975 CEFR rows takes about 6 seconds and adds about
22 MB. 4,462 entries have a frequency (97.8% of the 4,564 single unhyphenated
lemmas) and 2,785 have CEFR levels.

Within a headword batch, work items order by CEFR level and frequency within their stage (see Work
items, Priority). An import ends by re-ranking every worklist row and every
work item from the new tables, so the statement that replaces the reference
data also moves the queue. It then
marks every public view stale (`staleViewsSql`), since each public document
carries its entry's frequency and CEFR levels: it bumps `revision`, and
`scored_revision` with it where the scores were current, because reference
data is not part of the scores, and the items, already re-ranked, stay as they are. Reads
rebuild what they touch at once; run the admin rebuild (see Public view) to
drain the rest instead of waiting for the cron.

### Core entries

A learner must master the CEFR headwords first, so they are headword batch 1.
`POST /manage/v1/entries/core` (admins only, body `{ limit }`, 1 to 50, default
50) admits the next headwords of `lemma_cefr` that no entry has, lowest level
first and then by lemma, as live batch 1 entries the admin created, and answers
`{ created, skipped, remaining }`. Nothing is queued for review: admission is
not a fact. Their worklist rows read their learner priority, and their
`senses` items are stage 1 of batch 1, so they come first in the queue. A
single letter other than "a" and "I" names the letter, not a word, so it is
skipped and listed in `skipped` (`isLetterOfTheAlphabet`). Admitting them
reopens the slots passes were blocked on them. Fifty entries per call keep a
request well inside the Worker's D1 query budget. The operation is idempotent:
a repeated or concurrent call finds the lemmas that have entries by then, and
once `remaining` is 0 a call creates nothing.

After a reference import, an admin runs it until nothing remains:

```sh
until [ "$(curl -sf -X POST "$BASE/manage/v1/entries/core" \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN" -H 'content-type: application/json' \
  -d '{"limit":50}' | tee /dev/stderr | jq .remaining)" = 0 ]; do :; done
```

The migration `redesign` marked the 8,890 CEFR headwords that already had
entries as batch 1, kept the 2,591 phrases a learner's dictionary files under
them as phrase entries listed by their headwords' `phrases` facts, and removed
the 6,903 entries workers had created that were neither (inflections, literal
combinations), with their relations; their lemmas are candidates for the next
batches.

## Access

| Surface                   | Who                  | Credential                                   |
| ------------------------- | -------------------- | -------------------------------------------- |
| `/v1/*`, `/openapi.json`, `/docs` | Everyone     | None                                         |
| `GET /v1/*` as a service  | Downstream services  | Optional service key, for the per-service read limit |
| `/manage/v1/*`, `/manage/openapi.json` | Agents and admins | Agent API key or admin OIDC access token |
| `/manage/v1/agents`, `/manage/v1/services` | Admins only | Admin OIDC access token                 |
| `/manage/v1/facts/{id}/curate`, `curation` on `POST /manage/v1/facts`, `POST /manage/v1/entries`, `/manage/v1/tickets/{id}/resolve`, `POST /manage/v1/entries/{id}/passes`, `PUT /manage/v1/topics/{id}/image` | Curators: admins and curator agents | Admin OIDC access token or curator agent key |
| Admin console (SPA)       | Admins               | OIDC Authorization Code + PKCE               |

Admins are OIDC subjects listed in `ADMIN_SUBJECTS`. The console signs in with
no requested resource, so its access token authenticates the admin and carries
no API scope: an RFC 9068 JWT (`typ: at+jwt`) the Worker verifies against the
issuer's JWKS with the exact `OIDC_ISSUER` and `OIDC_AUDIENCE` (Realmroot sets
its UserInfo endpoint) and `client_id` equal to `OIDC_CLIENT_ID`, so a token
the same person got through another application of the issuer is refused.
Agent keys are random
secrets (`vn_agent_…`) that an admin issues. The Worker stores only their
SHA-256 hash. A valid OIDC token whose subject is not an admin gets 403. A
bearer that is not a structurally valid JWT gets 401 before the Worker contacts
the issuer; an unreachable issuer is a 500, not a bad credential.

**Service keys.** A downstream product that reads the dictionary for its own
users reads `/v1` as a service. An admin issues it a key with `POST
/manage/v1/services { name }`, which answers `{ service, key }` once; `GET
/manage/v1/services` lists the services and `DELETE /manage/v1/services/{id}`
revokes one. A service key is a random secret (`vn_service_…`) made and stored
exactly as an agent key is: only its SHA-256 hash, in the `services` table
(`id`, `name`, `key_hash`, `created_by`, `created_at`, `revoked_at`). The
service sends it as `Authorization: Bearer vn_service_…` on a public `GET`. The
key names the caller and nothing more: the read is counted against the
service's own allowance and logged with the service's id and name, and it
returns what an anonymous read returns. A key that names no service, or a
revoked one, is `401 invalid_credential`; a read that presents a key is never
served as anonymous. A service key is no management credential (`401` on
`/manage`), and any other `Authorization` value on `/v1` is not read: an agent
key there is an anonymous read. Vocnet is not an OAuth resource server; a
service is authenticated by its key alone.

## Web

One SPA serves two surfaces from the same origin. The public site needs no
sign-in and reads only the public API (`/v1`); the console lives under
`/console` and needs an admin sign-in. `/login` and `/callback` stay at the
root, since the OIDC client's registered redirect URI is `{origin}/callback`;
a completed sign-in lands on `/console`, and signing out returns to `/`.

- **Shell**: a top bar with the Vocnet mark, Browse, Developers, the language
  (English, 中文; stored versioned in `localStorage`, else the browser's
  preference) and theme toggles, and a Console link; a footer with the
  sources and licences of `GET /v1/sources`.
- **Search**: a combobox over `GET /v1/search?lang=zh` in the header and,
  larger, on the home page. Hits appear as you type (debounced); the arrow keys
  and Enter open one, Enter without a hit opens `/words/{text}` (an exact
  lookup), Escape closes, and `/` focuses it.
- **Home** (`/`): what Vocnet is, the search box, showcase cards into real
  relations (animal's kinds, bird's parts, hot and cold, dog in biology), and
  what the API returns.
- **Browse** (`/browse`): a category explorer (`?root={lemma}`, optional
  `?sense={id}` and `?domain=`) that resolves the category word through its
  entry, takes the sense with the most kinds, and expands direct kinds level
  by level, each the depth-1 members of `GET /v1/senses/{id}/members`; and the
  topics (`?view=topics`, `?topic={id}`): categories and their leaf topics from
  `GET /v1/topics`, a topic's senses from `GET /v1/topics/{id}/senses` most
  frequent first, page by page.
- **Developers** (`/developers`): the guide to the public API in Chinese or
  English (the site language, switchable in place) with a table of contents:
  base URL, no key for reads, rate limits, `?lang=`, `?domain=`, cursor
  pagination, caching, the error envelope and its stable codes, feedback, and
  every endpoint with a curl example and Try it, which calls the real API from
  the browser and shows the status, time, caching headers, and JSON, and
  whether the body matches the shared schema of that status. `POST
  /v1/feedback` is shown, not sent. It links to `/docs` and `/openapi.json`.
- **Entry** (`/words/{lemma}`): `GET /v1/entries/{lemma}?lang=zh`, typeset as
  a learner's dictionary: the headword with its syllables, UK and US
  pronunciations, CEFR levels, and a frequency band from the Zipf value; one
  section per part of speech with its forms and numbered senses (grammar
  codes, labels, gloss, translations, examples, collocations, relations, and
  topics); rare senses behind a summary; then the word family and phrases. A
  relation links to `/words/{lemma}#sense-{id}`, which opens and highlights
  that sense. `?domain=biology|medicine` switches the relation layer and is
  passed to the read. Every block has an API toggle with the exact `curl`
  request, a `jq` path, and the JSON slice of the response as sent. A 404 says
  the word is not in Vocnet yet and lists what `GET /v1/search` finds for the
  same text; the page never retries another spelling.

The browser policy is strict: `script-src 'self'`, fonts and styles bundled
(`font-src 'self'`), and no third-party origin but the OIDC issuer in
`connect-src`. `quality/performance-budgets.json` holds a budget per public
route and for the console.

## Console

The console is how admins watch the dictionary and how a curator works the
tickets. It reads through `/manage/v1` with the admin's access token. Besides
API keys its only writes are a curator's: resolving or dismissing a ticket and
settling a slot nothing can fill. Agents make every other change through the
API, so no page offers retract, re-review, or claim. The sign-in page and the
callback share its look and link back to the public site. A flat sidebar lists
the pages with what needs a look beside each (the entry count, low-credibility
facts, `N open` tickets, stuck tasks) and links the public dictionary, the
developer guide, and the API reference; on a narrow screen it opens from a menu
button.

- **Overview** (`/console`): average completeness, the low-credibility facts,
  open tasks with when A1 and the whole backlog finish at the current net rate,
  facts pending review and the oldest's wait past an hour, completeness per
  CEFR level, what needs attention (low-credibility facts linking to the audit
  tickets, stuck tasks to the stuck_work tickets, open tickets, timed-out tasks,
  reviews over an hour), and per kind a bar of published, low-credibility,
  pending, and rejected facts linking to those facts.
- **Entries** (`/console/entries`): every entry in lemma order with its level,
  senses, completeness split into published and pending, credibility, open
  tasks, and last update, filtered by prefix, level, and stuck in the URL.
  `GET /manage/v1/entries` serves it: a keyset page on the unique lemma index;
  every count starts from the page's entries and reaches their senses and facts
  through an index, and a test pins those query plans.
- **Entry inspector** (`/console/entries/{lemma}`): one lemma headed by its
  pronunciation, CEFR levels, frequency rank, whether it is live and its batch,
  and its scores; each sense in its inventory's order with its facts in every
  status, the relations pointing at it, and each open task where its fact would
  go; the word details, the reference data crediting each source, and the
  entry's open tasks in their own tab, each with a Settle action.
- **Facts** (`/console/facts`): facts newest first, each with its entry's lemma
  (the list's `entry`), kind, readable claim, and state, filtered by entry,
  kind, status, level, and author in the URL, beside the selected fact's
  detail: its entry and sense, the claim, its review, the task fixing it, and
  the corrections it replaced.
- **Tickets** (`/console/tickets`): Open, Resolved, Dismissed, and All tabs,
  each with its count from the stats, filtered by type, each ticket with its
  type, entry's lemma, and target, beside the selected ticket: its message, the
  fact, sense, entry, or lemma it is about, the open tasks of an entry or sense
  target, its resolution note, and the facts that fixed it. A curator resolves
  an open ticket with a note and the fixing fact ids, dismisses it with a note,
  or settles one of its target's tasks.
- **Tasks** (`/console/tasks`): the work summary over 24 hours or 7 days in the
  URL: open tasks by status, throughput, the forecast by level, each type by
  stage, and each agent's lease.
- **Activity** (`/console/tasks/activity`): completed attempts newest first,
  each with its try number, agent, entry and sense, task, result, time, and
  facts, filtered in the URL; a task opens in a sheet with what is missing, its
  times, every attempt numbered the same way, and a Settle action while open.
- **API Keys** (`/console/keys`): issue an agent key (shown once) and revoke one.

A review that is `uncertain`, or a pass below 0.8 confidence, is flagged
wherever a fact is listed: it is published with flaws. Listed facts and
tickets carry their entry; a relation names its target sense by id, so `GET
/manage/v1/nodes/{id}` resolves an entry or sense id to its owning entry for
linking.

The public wire format is snake_case JSON. Errors are
`{ "error": { "code", "message" } }` with stable codes; pages are
`{ items, next_cursor }` over keyset cursors with a unique tiebreaker. The
console reads its public OIDC settings from `GET /configz`.

## Public API

The public API is a learner's dictionary and a developer's data source, not a
dump of storage. `GET /v1/entries/{lemma}` is the only read that returns a full
entry document; every list returns summaries.

```json
{
  "lang": "zh",
  "id": "…",
  "lemma": "record",
  "frequency": { "zipf": 5.21, "rank": 606 },
  "pronunciations": [{ "ipa": "ˈrekərd", "accent": "us" }],
  "variants": [{ "form": "…" }],
  "syllables": ["rec", "ord"],
  "morphology": { "parts": [{ "form": "record", "role": "base", "lemma": "record" }], "family": [] },
  "meanings": [
    {
      "pos": "verb",
      "cefr": "A2",
      "productive_use": { "native": true, "learner": true },
      "skills": { "native": ["listen", "speak", "read", "write"], "learner": ["listen", "speak", "read", "write"] },
      "pronunciations": [{ "ipa": "rɪˈkɔːrd", "accent": "us" }],
      "forms": { "past": [{ "form": "recorded", "irregular": false }], "present_participle": [{ "form": "recording", "irregular": false }] },
      "senses": [
        {
          "id": "…", "gloss": "…", "labels": [], "rare": false, "translations": ["记录"],
          "grammar": { "transitivity": "transitive", "patterns": [], "prepositions": [] },
          "examples": [{ "sentence_id": "…", "text": "…", "translation": "…" }], "collocations": [{ "text": "…", "pattern": "verb_noun" }],
          "topics": [{ "id": "office", "name": { "en": "At the office", "zh": "办公室" }, "category": { "id": "work-economy", "name": { "en": "Work and economy", "zh": "工作与经济" } } }],
          "relations": { "synonyms": [{ "lemma": "log", "sense_id": "…", "gloss": "…" }],
            "antonyms": [], "broader": [], "narrower": [], "part_of": [], "parts": [] }
        }
      ]
    }
  ],
  "phrase_type": null,
  "phrases": {
    "by_sense": [{ "sense_id": "…", "phrases": [{ "lemma": "record player", "pos": ["noun"], "cefr": null, "gloss": "…" }] }],
    "phrasal_verbs": [],
    "idioms": [{ "lemma": "off the record", "pos": ["adverb"], "cefr": null, "gloss": "…", "translation": "…" }],
    "compounds": [],
    "sayings": [{ "sentence_id": "…", "text": "…", "meaning": "…", "translation": "…" }]
  }
}
```

- **Meanings.** One meaning per part of speech, in the order of each one's
  first sense in the inventory's order (see Sense inventory), with the CEFR level of
  the lemma in that part of speech or `null`.
- **Productive use.** A meaning's `productive_use` is `{ native, learner }`
  from its published productive use (see Productive use), each `true` for
  active and `false` for passive, and `skills` the skills each tier needs it
  for, computed rather than stored: active is `listen`, `speak`, `read`,
  `write`, passive `listen`, `read`; when every common sense of the part of
  speech is labelled `informal`, `slang`, `taboo`, or `offensive` only the
  spoken ones stay, and when every one is `formal` or `literary` only the
  written ones (`skillsOf` in `server/domain/productive-use.ts`). A meaning of
  only extra senses is passive for both tiers; one whose productive use is not
  published has `null` for both. With `?include=review` its
  `review.productive_use` names the fact, `null` when none is published.
- **Pronunciations.** The entry's `pronunciations` are the facts without a part
  of speech, the default. A meaning lists only the facts labelled with its part
  of speech, the ones that differ from the default. A weak form keeps
  `strength: "weak"`.
- **Forms.** A meaning's `forms` is an object keyed by inflection type; each
  value lists every published form of that type as `{ form, irregular, ipa?,
  accent? }` (`"past": [{ "form": "dreamed", "irregular": false }, { "form":
  "dreamt", "irregular": true }]`), because a type can have several; `irregular`
  is computed (see Syllables and form pronunciations)
  and `ipa` with `accent` shows when the form gives them. A form goes under exactly one
  meaning (`formMeaning` in the registry): the meaning of its labelled part of
  speech, else the meaning of the first part of speech the entry has in its
  type's carrier order, never by display order: a plural goes to a noun, else
  a pronoun, else a determiner (`mines` under the noun "mine" though the
  pronoun is shown first; `these` under the pronoun "this", which has no noun
  meaning, though its determiner is shown first); a past, participle, or third-person form to a verb,
  else an auxiliary (`would` under the auxiliary "will" only while "will" has
  no verb meaning); a comparative or superlative to an adjective, else an
  adverb, else a determiner (`more` under the determiner "many", and under
  the adverb "much", which has adverb, determiner, and pronoun meanings but
  no adjective one). An unlabelled verb form of an entry with both a verb and
  an auxiliary meaning goes to the verb (`would` under the verb "will"),
  because nothing in the data says which one it inflects; the producer labels
  it by a correction that supersedes it (`{ form: "would", type: "past", pos:
  "auxiliary", supersedes_id }`, see Write rules), and the regular forms
  (`willed`, `wills`, `willing`) with `verb` the same way. A
  form or a part-of-speech pronunciation with no meaning to show it is not
  shown in the entry document; it reappears when a sense of a part of speech
  that can carry it is published in the inventory, as a relation waits for its sense. Display
  never limits lookup: `GET /v1/forms/{form}` finds every published form of a
  public entry, shown or not. `variant` forms are the entry's `variants`, with
  their part of speech when labelled.
- **Senses.** The senses of the published inventory of a live entry, common in
  order and then extra, with the gloss and labels the inventory gives.
  `labels` is the register (empty for none), `region` is the variety a sense
  only it uses (null when every variety does), `rare` marks a sense the
  inventory ranks `extra`, `translations` lists the sense's equivalents in the
  read's language, an example's and a collocation's `translation` is its own
  translation fact's text in that language (absent without a language, by tag
  with `lang=all`), and `grammar` lists `patterns` and `prepositions` (empty
  when none). A translation of a superseded example or collocation is shown
  nowhere. `relations` groups related senses by what
  they say about this one: `synonyms` and `antonyms` from either end;
  `broader` for a hypernym this sense is the subject of and `narrower` for one
  it is the target of; `part_of` for a part-of this sense is the subject of and
  `parts` for one it is the target of. Each related sense is `{ lemma,
  sense_id, gloss }`, and a hypernym of a specialist taxonomy also `domain`.
  The everyday layer always shows; `?domain=biology` (or `medicine`) adds that
  domain's broader and narrower terms, each marked with it, and an unknown
  domain is `400 invalid_request`. The domain is part of the read's variant, so
  it changes the ETag. `GET /v1/senses/{id}` takes `?domain=` the same way.
- **Word formation.** Each part carries `lemma` when a public entry has exactly
  that spelling. `family` lists, as summaries in lemma order, the other public
  entries whose word formation has a part of the same form and role among
  `base` and `root` (`happiness` and `unhappy` share the base `happy`).
- **Phrases.** The headword's published `phrases` fact (see Headwords and
  phrases), grouped: `by_sense` lists, in sense order, the phrases filed under a
  sense the document shows; the rest go by type into `phrasal_verbs`, `idioms`
  (idioms and fixed phrases), and `compounds`; each a summary of the public
  entry, in the list's order, shown once it is public itself. `sayings` lists
  `{ sentence_id, text, meaning, translation? }`, the meaning null until
  published. A phrase entry's document has `phrase_type` (the type the
  earliest published list naming it gives; null for a single word or an
  untyped phrase). An example is `{ sentence_id, text, translation? }`.
- **Sentences.** `GET /v1/sentences/{id}` returns `{ lang, id, text, source,
  meaning, translation?, examples_of: [{ lemma, sense_id }], saying_of: [lemma]
  }`, read from the public documents that show it, so it is public only as a
  published example of a public sense or a saying of a public headword's
  published list; anything else is `404`. Its ETag covers those documents.
- **Review metadata.** Fact ids, confidence, and verdict appear only with
  `?include=review`: every object a published fact shows gains `review: {
  fact_id, confidence, verdict }`; claims shown as strings have theirs in the
  owner's `review` (a sense's `review.gloss`, which is the inventory that
  states it, and `review.translations`, in the shape of its translations, a
  meaning's `review.forms`, and the entry's `review.inventory`,
  `review.syllables`, and `review.phrases`, null when none is published).
  Feedback on a fact names it by these ids. Sources appear only in `GET /v1/sources`.

**Language.** The dataset serves the languages it collects translations in
(`SERVED_LANGUAGES` in `shared/facts.ts`; the worklist asks for `zh`, and a
translation is submitted only in a served language). Every stored translation is tagged plain `zh` and is Simplified
Chinese: in this dataset `zh` means Simplified. A requested tag reads a served
language only in the same script, never another language or script:

| Request                                   | Reads  |
| ----------------------------------------- | ------ |
| `zh`, `zh-Hans`, `zh-Hans-*`, `zh-CN`, `zh-SG` | `zh`   |
| `zh-Hant`, `zh-Hant-*`, `zh-TW`, `zh-HK`, `zh-MO`, any other `zh-*` | none |
| another tag                               | a served tag it equals, or one it only adds a region subtag to (`pt-BR` reads `pt`); never a longer tag or another script |

A read picks its language with `?lang=` (a BCP 47 tag, or `all` in any case),
else with `Accept-Language`: the most preferred tag (highest quality, first of
equals, ignoring `*` and `q=0`) that reads a served language. `?lang=` wins;
a `?lang=` tag that reads no served language gives no language. Responses
carry `lang`, the stored tag used (`"zh"` for a `zh-CN` request), `all`, or
`null` when no language is read. A sense's `translations` is the list in that
language, empty when it has none, and absent without a language; `?lang=all`
gives an object keyed by stored tag. `all` is accepted only by the document
reads (`GET /v1/entries/{lemma}`, `GET /v1/senses/{id}`); the lists
(`GET /v1/entries`, `GET /v1/overviews`, `GET /v1/forms/{form}`, `GET
/v1/topics/{id}/senses`, `GET /v1/senses/{id}/members`, `GET /v1/search`) reject it with `400 invalid_request`, so every summary has one shape. A
topic's `name` is `{ "en": …, "<lang>": … }` keyed by the stored tag, with the
language only when the topic has a name in it (the taxonomy has English and
Chinese names), and every name for `all`.

**Summaries.** Every list returns only summaries: `GET /v1/entries`, morphology
`family`, `phrases`, and the entry of a sense read return the word summary
`{ lemma, pos, cefr, gloss, translation? }`: the parts of speech of its meanings,
the lemma's lowest CEFR level or `null`, its first sense's gloss (or `null`
without a public sense), and that sense's first translation in the read's
language, a string, absent without a language, with `all` (in a document
read's phrases, family, and entry), or without a translation. `GET /v1/topics/{id}/senses` returns the sense summary
`{ lemma, sense_id, pos, cefr, gloss, translation? }` of each tagged sense,
with the CEFR level of its part of speech. `GET /v1/forms/{form}` returns a word
summary per owning entry with `matches: [{ type, pos? }]`, each published form
with that spelling and the part of speech it is shown under, else its label;
a form the document does not show is still found. List pages are
`{ lang, items, next_cursor }`; a form lookup is `{ lang, items }`.

`GET /v1/senses/{id}` returns the sense in the entry document's shape with its
`pos`, its entry's word summary as `entry`, and `lang`; it takes `?lang=` and
`?include=review` like the entry.

`GET /v1/senses/{id}/members?domain=&lang=&limit=&cursor=` lists the members of
a public sense taken as a category: every public sense whose broader terms lead
up to it, in the everyday layer and, with `domain`, that domain's as well, each
once at its nearest `depth` (1 for a direct kind), as `{ lang, total, items:
[sense summary + depth + parents], next_cursor }` ordered by depth, lemma, and
sense id, so the pages go down the category level by level. "animal"
lists dog, cat, and bird at depth 1 and eagle, through bird, at 2; with
`domain=biology`, "carnivore" lists canine and then dog. `parents` is the ids
of the senses the member is a direct kind of within the walk, in the layers
walked: the category itself or other members, so a client rebuilds the tree
(or, where a member has two parents, the graph) from one flat list, and a
broader term outside the category is left out. `total` is how many members the
walk reaches, on every page, so a client can say "388 kinds" before it has
read them all. It walks the view's
`public_hypernyms` rows (one per broader term a public sense shows, with the
narrower sense's summary) in one recursive query, bounded at `MEMBER_DEPTH`
(12), the depth that also ends a walk round a cycle of three or more entries. A
sense that is not public is `404 not_found`. It is a list, cached for five
seconds like the others.

**Overviews.** `GET /v1/overviews?lemma=&lemma=&senses=&lang=` returns what a
word card shows for up to 100 entries in one read, so a page of a topic's words
needs one request, not one entry document per word:

```json
{ "lang": "zh", "items": [
  { "id": "…", "lemma": "bright", "cefr": "A1", "frequency": { "zipf": 4.61, "rank": 2410 },
    "pronunciations": [{ "ipa": "braɪt", "accent": "us" }, { "ipa": "braɪt", "accent": "uk" }],
    "meanings": [
      { "pos": "adjective", "cefr": "A1", "pronunciations": [], "sense_count": 7,
        "senses": [{ "id": "…", "gloss": "Giving out or reflecting a lot of light.", "rare": false, "translations": ["明亮的"] }] }
    ] }
], "missing": ["brite"] }
```

`lemma` is repeated, one exact lemma each (a value is never split at a comma,
which a lemma may hold); none, or more than 100, is `400`. Each public entry
comes once, in the order first asked, with its default pronunciations and, per
part of speech in document order, its level, the pronunciations particular to
it, `sense_count` (every public sense of that part of speech), and its first
`senses` senses (4 by default, 1 to 10) with `rare` and every translation in
the read's language, absent without one. A lemma no public entry is spelled
exactly like is listed in `missing` as it was asked; there is no case folding
or form lookup. It is a list: it reads the built `public_entries` documents in
one statement, takes one language (`lang=all` is `400`), and is cached for
five seconds.

**Lists.** `GET /v1/entries` takes `prefix`, `level` (CEFR levels, repeated
`level=A1&level=A2` or comma-separated `level=A1,A2`), `pos`, `topic` (a leaf
topic, or a category for any of its leaves), and `sort` (`lemma`, the default,
or `frequency`: most frequent first by the entry's frequency rank, entries
without one last, ties by lemma). `level` and `pos` hold for one meaning: an
entry is listed when one of its meanings has that part of speech and one of
those levels (the CEFR level of the lemma in that part of speech), so
`level=A1&pos=noun` lists the A1 nouns, not entries that are A1 as a verb and
also nouns. With `topic`, they hold for one common sense tagged with the topic,
at the level of its part of speech: a topic on a sense the entry's inventory
ranks `extra` does not list the entry, since a learner browsing the topic
would not meet the word in that sense (`public_sense_topics.rare`). `GET
/v1/topics/{id}/senses` still lists the rare sense itself. An unknown topic is `404 not_found`; an
unknown level, part of speech, or sort is `400 invalid_request`. `GET
/v1/topics/{id}/senses` takes `sort`: `lemma` (the default, then by sense),
`frequency` (by the entry's frequency rank), or `level` (by the sense's
CEFR level, lowest first); unranked or unlevelled senses go last, ties by
lemma, then sense. Every sort pages by keyset over its whole sort key, so a
cursor names the sort it came from and is `400 invalid_cursor` under another.

**Search.** `GET /v1/search?q=&lang=&limit=&cursor=` returns `{ lang, items,
next_cursor }` with each item a word summary plus `match`, what matched:

```json
{ "lang": "zh", "items": [
  { "lemma": "bank", "pos": ["noun", "verb"], "cefr": "A1", "gloss": "…", "translation": "银行（金融机构）", "match": "lemma" },
  { "lemma": "banker", "pos": [], "cefr": "B2", "gloss": null, "match": "lemma" },
  { "lemma": "account", "pos": ["noun", "verb"], "cefr": "A2", "gloss": "… with a bank …", "translation": "银行账户", "match": "gloss" }
], "next_cursor": "…" }
```

An entry is found by `q` as its exact lemma or a published spelling variant of
it (rank 0, `match` `lemma`), a lemma that starts with
`q` (1), a gloss (2), a translation in the read's language (3), or an example (4)
of one of its public senses that holds every word of `q`; it appears once, at its
best rank, then by frequency rank (unranked last), then by lemma, and `match` is
`lemma`, `gloss`, `translation`, or `example`. Lemmas match exactly as spelled,
like every lookup; text matches fold case and diacritics but are otherwise
exact: no stemming and no typo correction (`bnak` and `banks` find nothing a
gloss does not literally hold). Fuzzy matching is a follow-up. Translations are
searched only in the language the read resolves (`?lang=` or
`Accept-Language`), so a Chinese query without a served language finds nothing.
Chinese has no spaces between words, so the index stores each run of CJK
characters as its characters and every pair of neighbours (`银行业` as 银 行 业
银行 行业), and a query looks a run up by its pairs: `银行` finds every
translation holding 银行 (`银行`, `银行家`, `银行账户`), `银行家` those holding both
银行 and 行家, and a single character itself (`server/domain/search.ts`).

**Rate limits.** Every public `GET` counts against the client address
(`CF-Connecting-IP`) in the `READ_RATE_LIMITER` binding: 120 a minute. More is
`429 rate_limited` with `Retry-After: 60`, the binding's period, since the
binding reports no finer reset. Cache hits count too: the limit protects the
Worker, not only D1. Feedback keeps its own limit of 10 a minute.

A read with a service key (see Access) counts against the service instead, by
its id in the `SERVICE_READ_RATE_LIMITER` binding: 6000 a minute, the budget of
a backend that reads for many users from a few addresses. The client address is
not read at all for it, so a service may call from anywhere, with or without
Cloudflare in front. A read without a key still needs `CF-Connecting-IP` and
fails as a `500` without it: Cloudflare always sets the header in production,
and locally Miniflare sets it from the socket's address (and passes on one the
client sent), so the failure only shows when the Worker is called with no such
runtime in front.

## Public view

The public reads serve prebuilt documents instead of projecting an entry's
facts on every request. An entry's stored document is the entry in the shape
of the Public API with every language and every review, plus an index of every
published form that reads never show: `projectPublicEntry` in
`server/domain/catalog-view.ts` projects it from the entry's facts, its
reference data, and the topic names. A read cuts the requested language and
review out of it (`shapeEntry` in `server/domain/public-view.ts`), so one
document serves every variant, and joins what other entries supply. The view
is derived data only, never a second source of truth: every row can be dropped
and rebuilt from the facts, the topics, and the reference tables, and nothing
writes it but the rebuild.

| Table                 | Columns                                                      | Key                              |
| --------------------- | ------------------------------------------------------------ | -------------------------------- |
| `public_entries`      | `entry_id`, `lemma` (unique), `document`, `digest`, `summary`, `frequency_order`, `built_at` | `entry_id`; indexed by `(frequency_order, lemma)` |
| `public_meanings`     | `entry_id`, `pos`, `cefr`                                    | `(entry_id, pos)`                |
| `public_forms`        | `form`, `entry_id`, `type`, `pos`                            | indexed by `form`                |
| `public_sense_topics` | `topic_id`, `lemma`, `sense_id`, `entry_id`, `pos`, `cefr`, `level_order`, `frequency_order`, `summary` | `(topic_id, lemma, sense_id)`; indexed by `(topic_id, frequency_order, lemma, sense_id)`, `(topic_id, level_order, lemma, sense_id)`, and `(entry_id, topic_id)` |
| `public_morphemes`    | `form`, `role`, `entry_id`                                   | `(form, role, entry_id)`         |
| `public_search`       | `id`, `entry_id`, `field`, `scope`, `body`                   | `id`; FTS5 `public_search_fts` over `body` |

`document` is the serialized stored document and `digest` the first 128 bits
of its SHA-256 in hex. `summary` is the entry's word summary with its first
translation in every language. `built_at` is when the document last changed: a
rebuild that produces the same digest leaves the row alone. Every row derives
from the entry's own document (`publicViewRecord`). `frequency_order` is the
entry's frequency rank, or 2³¹−1 without one, so a sort by it puts unranked
entries last and a keyset cursor stays a plain integer. `public_meanings` has a
row per meaning with its CEFR level; `public_forms` a row per published form,
shown or not (the document's form index), by its spelling as the form fact
normalizes it, with the part of speech it is shown under, else its label, so a
form lookup matches exactly as the facts do; `public_sense_topics` a row per
topic tag of a public sense with its part of speech, level, `level_order` (the
level's rank, 7 without one), the entry's `frequency_order`, and its sense
summary; `public_morphemes` a row per part of its word formation; and `public_search` a
row per distinct gloss (`field` `gloss`, `scope` `en`), example (`example`,
`en`), and translation (`translation`, its language tag) of a public sense,
whose `body` is the text as the search index stores it (see Search).
`public_search_fts` is an FTS5 table (`unicode61 remove_diacritics 2`) with
`public_search` as its external content: it stores only the index, and two
triggers on `public_search` insert and delete its entries, so a rebuild writes
`public_search` rows like any other. It is a virtual table, which `wrangler d1
export` cannot export: drop `public_search_fts` before an export, and restore it
by running `migrations/20261110034927_public_search_fts.sql` and then `INSERT
INTO public_search_fts(public_search_fts) VALUES ('rebuild')`. An entry that is
not live, or has no published inventory, has no rows, so every public read of it
is `404`.

| Read                          | Served from                                                    |
| ----------------------------- | -------------------------------------------------------------- |
| `GET /v1/entries/{lemma}`     | One batch: `entries` by lemma with its worklist row and `public_entries` row; the summaries of the public entries its document's phrases list names, in its order; the summaries of the entries whose `public_morphemes` share a base or root with its own; and its parts that are a public lemma |
| `GET /v1/senses/{id}`         | The same statement from `senses`; the sense is cut out of the document |
| `GET /v1/forms/{form}`        | `public_forms` by spelling joined to `public_entries`, in lemma order |
| `GET /v1/entries`             | `public_entries` summaries by lemma range or along `(frequency_order, lemma)`, each checked through the key of `public_meanings`, or with a topic the `(entry_id, topic_id)` index of `public_sense_topics` |
| `GET /v1/topics/{id}/senses`  | `public_sense_topics` summaries by leaf along the index of the sort |
| `GET /v1/topics`              | `topics`, and two grouped counts over `public_sense_topics`: per leaf, and per category through `topics.parent_id` |
| `GET /v1/media/{id}`          | The `MEDIA` R2 bucket by key, streamed                         |
| `GET /v1/overviews`           | `public_entries` documents by exact lemma, one statement for every lemma asked |
| `GET /v1/senses/{id}/members` | One recursive walk down `public_hypernyms`, with each member's parents and the total from the same statement |
| `GET /v1/search`              | `public_entries` by exact lemma and lemma range, `public_forms` by variant form, and `public_search_fts` joined to `public_search` by rowid, grouped by entry |

Feedback targets are checked against the live projection, and the management
API keeps reading the facts: they need every status.

**Linked entries.** Two kinds of data cross entries. A relation's other sense
is part of the stored document: a write to either end bumps the revision of
the entries both senses belong to (see The worklist and work item tables), so both views go
stale and are rebuilt. Phrases, the word family, and the part links are joined
on read instead: the headword's document holds its phrases list, and each read
joins the summaries of the listed phrases that have a public view, so "give up"
shows under "give" once it is public, with no rebuild of "give". A changed word formation
replaces the entry's own `public_morphemes` rows, so its old family stops
finding it and its new one starts. No write therefore has to find the entries
that list another entry as a phrase or relative, and none can miss one. These
joins read only built rows, so they lag a write like the lists do.

**Staleness.** The view shares the worklist's `revision`: a view is stale while
`view_revision <> revision` (partial index `worklist_view_stale_idx`). Every
write that can change a document already bumps `revision` in its own batch (see
The worklist and work item tables), and `refreshEntries` rebuilds the stale views of the
entries the write touched, linked entries included, in the same request after
the rescore. A rebuild reads the revision, loads the snapshot, the reference
data, and the topic names, and writes the document and every lookup row and
`view_revision` in one batch whose every statement is conditional on
`revision` being unchanged, so a write that lands meanwhile wins: the rebuild
stores nothing and that write's own refresh rebuilds the view. The cron
rebuilds up to 100 leftover stale views a run (`rebuildStalePublicViews`),
trying every one before it throws the failures together, like the rescore.
The topic names are curated by migration; a migration that renames a topic
must bump the revision of the entries tagged with it (see Backfill and
rebuild).

A read never serves an entry or sense document older than the facts it read:
the read's statement returns the revisions with the document, and a stale view
is rebuilt before it is served. The only window is a write that commits during
that rebuild, which the read then serves the previous document across, for the
milliseconds until the write's own refresh finishes. When the lost rebuild
leaves no document at all (the view was never built), serving it would be a
`404` for a public entry, so the read rebuilds again, up to three times, and is
`404` only when the projection itself is empty. Form lookups, the lists, search,
and the phrases, family, and part links of an entry read only built rows; they
lag a write only between its commit and its refresh in the same request (and
the lists and search up to five seconds more through a cache), and by
at most one cron run (five minutes) when that request dies in between, or after
a reference import or a migration until the views are rebuilt.

**HTTP caching.** Entry, sense, and form responses carry `ETag` and
`Cache-Control: public, no-cache`; a matching `If-None-Match` gets `304`
without a body. The ETag is the first 128 bits of the SHA-256 of what the body
is cut from and the variant asked for: the document digest and, for an entry,
the summaries and part links it joins; for a form lookup the digests of the
matched entries; and the language and `include` of the read. So each language
and review variant has its own ETag, and an entry's ETag changes when a phrase
or relative it lists does. Every public read depends on `Accept-Language`, so
every public read carries `Vary: Accept-Language`. The staleness budget of a
public read is a few seconds, and a write rebuilds its views within its own
request, so a cache must not keep a document fresh past it: every use
revalidates, and the revalidation costs one indexed batch and no body. The
ETag changes only when the body can, so feedback and completed work, which
bump the revision without changing anything public, keep cached bodies valid.
`GET /v1/entries`, `GET /v1/topics`, `GET /v1/topics/{id}/senses`, `GET
/v1/overviews`, `GET /v1/senses/{id}/members`, and `GET /v1/search` change
whenever any entry in them does; an ETag would need the whole page query before
a `304` could save only the body, so they carry `Cache-Control: public,
max-age=5`, which stays within the budget, and no ETag. Two of them are lists
a client reads whole and keeps, so they carry a strong ETag beside the
max-age and answer `If-None-Match` with `304`: `GET /v1/overviews`, over the
sense limit and each asked lemma's document digest (or that it is missing),
read with the documents in the one statement; and `GET /v1/topics`, over the
taxonomy with its counts. The `304` saves the body, not the query. Errors and the feedback
POST carry no caching headers.

**Edge cache.** The Worker runs in front of Cloudflare's cache, so the edge
stores nothing by itself; `publicReadBoundary` (`server/http/public-reads.ts`)
puts responses in the Workers Cache API (`caches.default`, the cache of the
colo serving the request) itself, after the read rate limit. It stores exactly
the `200` `GET` responses whose own headers let a shared cache keep them fresh
(`public` with a `max-age`, and no `no-cache`, `no-store`, or `private`): the
lists. Documents and form lookups are `no-cache`, so they are never
stored: a stored body would still need the same indexed batch to revalidate,
and that batch already answers a matching `If-None-Match` with a bodiless
`304`. The key is the request URL and, when it has no `?lang=`, the served
language its `Accept-Language` reads (`?lang=zh&vary=accept-language` appended),
because the Cache API ignores `Vary` and the body depends on nothing else in
that header; a `?lang=` stays as sent, so a value the route rejects never
shares a key with one it serves. The stored copy drops `Vary` and carries the
`Date` it was stored; a hit is served with `Vary: Accept-Language` restored and
`Age` set from that date, so a browser or downstream cache keeps it only for
what is left of the five seconds. A hit that carries an ETag (the overviews
and the taxonomy) and whose ETag the request's `If-None-Match` holds is
answered `304` without the body, as the route answers it. A list is therefore at most five seconds
older than the view it was read from, at the edge or anywhere downstream, plus
the lag every list has behind a write (see Staleness). The cache is per colo
and is not purged on write: the max-age is the bound. The integration suite
runs the Cache API off (`cache: false` in `vitest.config.ts`), because tests
reuse URLs within five seconds; the boundary is proven over a fake cache.

**Backfill and rebuild.** A migration cannot run the projection, so a
migration that changes what a view stores marks every view stale and leaves
the rows to the rebuild: `public_view_backfill` set `view_revision = revision -
1`, and `public_api_v2_clear` emptied the view tables and bumped `revision` on
every row, and `scored_revision` with it where the scores were current, as a
reference import does, so the scores stay current; `public_view_v3_clear` did
the same for search and filtered lists, and `form_pos_content_key` bumped the
entries whose form keys it rewrote. `redesign` bumps `revision` on every row,
since the gap rules and the document shape changed, so every score and view is
recomputed. Reads of entries and
senses rebuild what they touch; `POST /manage/v1/public/rebuild` (admins only,
body `{ limit }`, 1 to 200, default 100) rebuilds up to `limit` stale views and
returns `{ rebuilt, remaining }`. Form lookups, the lists, search, and the joined
phrases and families read only built rows, so after `wrangler d1 migrations
apply` of a migration that marks views stale, repeat it until `remaining` is 0
before relying on them:

```sh
until [ "$(curl -sf -X POST "$BASE/manage/v1/public/rebuild" \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"limit":200}' | jq .remaining)" = 0 ]; do :; done
```

A data migration cannot rebuild a view either, and nothing else notices that it
changed what a document shows. Any migration that rewrites fact payloads,
statuses, or content keys, entry lemmas, sense glosses, topic names, reference
data, or anything else a public document is projected from must bump
`revision` on the worklist rows of the entries it touches, in the same
migration, so their views go stale and are rebuilt. Deploy such a migration
with the drain above.

On a local copy of the development database (12,558 entries, 11,916 public),
the two `public_api_v2` migrations took about a second, and 63 rebuild calls
of 200 rebuilt every view in 33 seconds, about 360 entries a second, producing
11,916 documents (21.9 MB with every language and review, up from 19.3 MB),
4,742 form rows, 3,990 topic rows, 2,120 phrase-word rows, and 1,519
word-formation rows. 156 published forms are not shown because their entry has
no public sense of their part of speech yet. The largest document, `run`, is
27.7 KB without a language (29.4 KB in `zh`, 57 KB with `lang=all` and
`include=review`) instead of 50.6 KB. Served through `wrangler dev`, reads
stayed within the noise of the earlier view: `run` 3.8 to 4.0 ms before and
4.1 to 4.7 ms after, and a mean entry (2.9 ms), sense (2.8 ms), form lookup
(2.7 ms), topic page (3.1 to 3.5 ms), and list page (2.5 to 2.8 ms) the same.

On a later copy (12,663 entries, 12,015 public), the four migrations of search,
filtered lists, and form keys (`public_view_v3_clear`, `public_view_v3`,
`public_search_fts`, `form_pos_content_key`, which rekeyed 2,839 labelled form
facts with no collision) applied in 2.4 seconds through `wrangler d1
migrations apply --local`, and 64 rebuild calls of 200 rebuilt every view in
42 seconds, about 290 entries a second, producing 12,015 documents (23.6 MB),
8,128 meaning rows, 4,889 form rows, 4,178 topic rows, and 29,790 search rows
(15,179 glosses, 6,992 translations, 7,619 examples; 1.5 MB of indexed text),
8.4 MB more database in all. Through `wrangler dev`: a search 3 to 14 ms
(`bank`, `银行`, `rel`), a one-letter search, which matches most glosses, 15 to
120 ms; a list by level and part of speech or a topic page by frequency or level
about 5 ms, and a topic-filtered list by frequency, which walks the frequency
index checking each entry, 10 to 18 ms; `run` in `zh` 4 ms as before.

## Public replica

Until production moves online, the facts are produced on a local deployment
and production is a public replica: it serves the public reads (`/v1/*`) from
rows copied out of the local database, holds no facts, and runs no reviews.
`pnpm replica:sync -- --remote` (`scripts/replica/sync.mjs`) copies them; with
`-- --local --persist-to <dir>` it rehearses against a local database instead.

The unit of a copy is one public entry (`server/domain/replica.ts`): its
`entries` row, its `senses` rows, a `worklist` row, and its rows in every
public view table. The topic taxonomy is one more unit. The worklist row keeps
only `entry_id`, `created_at`, and `live`, so every revision on the replica is
0 and no view is ever stale there: a stale view would be rebuilt from facts
the replica does not have. A `public_search` row drops its id; the replica
numbers its own rows and its triggers keep `public_search_fts` in step.

The replica keeps `replica_manifest` (`key`, `fingerprint`, `synced_at`; key
`entry:<id>`, `topics`, or `media:<id>`), which only the sync reads or writes and the sync
creates. A unit's fingerprint is the first 128 bits of the SHA-256 of its rows,
each row's values in column order and the rows sorted. A sync reads every unit
of the local database in one read transaction, so it sees one snapshot while
the producer keeps writing; reads the replica's manifest; pushes the units the
replica lacks or holds with another fingerprint; and removes the entries the
replica holds that are no longer public. Removals go first, since a removed
entry may hold the lemma a pushed entry takes. Pushing a unit deletes the
replica's rows of it and inserts the source's, and writes its manifest row
last, so a sync cut off midway copies the unfinished units again on the next
run, and running it twice changes nothing. The statements of the sync go to
the replica as `wrangler d1 execute --file` imports of up to 50 MB, one row of
`public_entries` to a statement under D1's 100 KB statement limit. An import
holds the database while it runs, so a first sync of every entry makes the
replica unavailable for its duration; a later sync copies only what changed.

Media files go first. The sync lists the files the source's rows name (the
topics' `image_id` and the pictures of published image facts), copies each one the manifest lacks from the local bucket
(`wrangler r2 object get --local`) to the replica's (`wrangler r2 object put`;
`--bucket vocnet-media-preview` for a preview, whose bucket the `--preview` flag
of `d1 execute` does not reach), and records it as `media:<id>` with its id as
fingerprint, so no row the replica serves names a file it lacks. A file is
named by its content, so the key alone says it is there and unchanged, and the
sync never removes one.

What a replica cannot answer: feedback is `404` for every target, because it
is checked against the live projection of the facts (see Feedback), which the
replica does not have. The management API answers, but over a database with no
facts or work. The replica's reviewer gateway is `https://models.invalid`,
which never resolves, so a review there fails loudly instead of reaching a model.

## Runtime

- One Worker serves the API, the OpenAPI documents, and the console assets.
- D1 stores nodes, facts, the topic taxonomy, tickets, agents, the worklist and work items, the public view, and
  imported reference data. R2 stores media files (see Media).
- A Cloudflare Queue carries `{ fact_id, trace_id }` review jobs. Its consumer
  takes batches of up to 48, reviews them concurrently, and logs the trace ID.
  Each batch logs a `review_batch` start and end, and each review a `review_stage`
  line as each step ends (`loaded`, `judged`, `transitioned`, `admitted`,
  `refreshed`), so a batch that never ends names the review and the step it
  stopped after. D1 runs one statement at a time, so the database binding logs
  every statement that takes 500 ms or longer as `slow_query` with its SQL
  (`server/adapters/d1-timing.ts`): a slow statement delays every request behind it.
  A scan of one kind's payloads (phrases lists, morphology parts) names the kind
  index (`indexed by facts_kind_payload_idx`): ordered by creation time, SQLite
  otherwise walked every published fact through the status index, five seconds
  a phrase-type lookup, and that one statement held claims, completions, and
  reviews behind it.
  The console's fact counts by status, kind, and reviewer read the expression
  index `facts_status_kind_reviewer_idx` (`status, kind, review->reviewer`):
  reading every published row's review JSON took 17 s and held D1 the same way.
  A batch waits for its slowest review, so the batch is sized to keep the
  per-model caps below busy: 48 reviews queue behind 8 LLM slots, which stay
  full while one slow call finishes, so a batch no longer waits on its tail.
  Within a batch each gateway model also has its own cap, `JEV_CONCURRENCY`
  and `REVIEW_LLM_CONCURRENCY` (10 and 8), measured as the balance where the
  gateway keeps answering while it queues what its upstream rate-limits: a review waits its turn for a slot
  before its call starts, so the wait never counts against the call's timeout.
  The caps are per batch, not per Worker: the runtime cancels a continuation
  that another request resolves, so requests cannot share a limit.
- A cron trigger runs every five minutes, rescores up to 100 stale worklist
  rows, rebuilds up to 100 stale public views, and re-enqueues facts whose last
  status change is more than an hour old and that are still `pending`, so
  a lost enqueue cannot strand a fact (an hour outlasts a review backlog, so a
  fact still waiting in the queue is not enqueued twice); it keys on `updated_at`, not
  `created_at`, so a re-reviewed fact counts from its reset. It stamps each fact it
  re-enqueues (`facts.review_enqueued_at`) and skips it until another hour has
  passed, so a backlog longer than an hour is not re-enqueued on every cron run
  (the local cron loop runs back to back while rows are stale). It also deletes the
  leases that expired more than a day ago.
- A reviewer transport failure (network, timeout, 429, 5xx) retries the message with a
  delay; after five attempts it lands in the `vocnet-reviews-dlq` dead letter
  queue, and the cron keeps re-enqueueing the fact until review succeeds.
