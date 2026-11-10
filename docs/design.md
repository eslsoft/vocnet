# Vocnet design

Vocnet is a relational English dictionary that external agents maintain
continuously. The data is the product. A Cloudflare Worker serves a public,
read-mostly OpenAPI API and a management API that only administrators and
registered agents can use. Agents run outside the system. They submit raw data
and work through user feedback. The system reviews every piece of data on its
own and publishes it on its own.

## Principles

- **Review and publish per fact.** The unit of review is one fact, not one
  word. A fact never waits for another fact to be ready.
- **Publish with flaws, correct later.** A review that passes or is uncertain
  publishes the fact with its confidence. Only a failing review rejects it.
  Corrections supersede published facts.
- **Precise reviewer when one exists.** Facts that state a checkable
  proposition go to Jev first. Facts whose quality is a judgment go to a
  general LLM. A Jev pass is trusted; anything else gets an LLM second opinion.
- **Visibility is derived on read.** The public API shows a fact only when it
  and every node it references are published.
- **Every write converges.** Submissions are idempotent by content key, review
  is idempotent by fact status, and a reconciler re-enqueues stuck work.

## Data model

### Nodes

Nodes are stable identities. They carry only the attributes that define
identity, never reviewed content.

| Table     | Columns                                           | Identity rule                       |
| --------- | ------------------------------------------------- | ----------------------------------- |
| `entries` | `id`, `lemma` (normalized, unique), `created_by`  | One entry per lemma spelling        |
| `senses`  | `id`, `entry_id`, `pos`, `creation_key`, `created_by` | POS is identity; gloss is a fact |

Correcting a sense's POS means a new sense, not an edit. A sense is identified
by its gloss text alone, never by its `register` label. Creating a sense returns
the existing one when a live gloss of that entry and POS has the same text with
any register, or none, and the create's own register is then ignored. An agent
labels an existing sense through a correction of its gloss. `creation_key` is the
gloss's meaning key (its case-folded text, without the register) at creation. A
unique index on `(entry_id, pos, creation_key)` makes concurrent creations of
one gloss converge on one sense, whatever registers they carry: the losing
request inserts nothing and returns the winner's sense and gloss fact. A node is publicly
visible when its defining fact (`entry` for an entry, `sense` for a sense) is
published.

### Facts

Everything else is a fact: one row in `facts`, one reviewed claim.

| Column          | Meaning                                                        |
| --------------- | -------------------------------------------------------------- |
| `id`            | Stable fact ID                                                 |
| `kind`          | Key into the fact-kind registry                                |
| `subject_id`    | Entry or sense the fact is about (registry says which)         |
| `object_id`     | Referenced sense for relations, else null                      |
| `content_key`   | Deterministic key of the identifying payload, for dedupe       |
| `payload`       | Kind-specific JSON, validated by the registry schema           |
| `status`        | `pending`, `published`, `rejected`, `superseded`, `retracted`  |
| `exclusive`     | The kind's cardinality is *one*, copied from the registry      |
| `supersedes_id` | Fact this one corrects, if any                                 |
| `author`        | Agent or admin principal that submitted it                     |
| `review`        | Reviewer, verdict, confidence, reason, raw detail, reviewed at |
| `revalidate_since` | When the fact was marked for re-review against a new gloss  |

A partial unique index on `(kind, content_key, subject_id)` over `pending` and
`published` rows (the *live* facts) makes resubmission return the existing
fact. `content_key` precedes `subject_id` so lookups by content, such as finding
the entries that own a form, use the same index.

### Fact kinds

The registry in `server/domain/fact-kinds.ts` is the single source of truth.
Each kind declares its subject type, payload schema, content key, reviewer
chain, and review prompts. Adding a kind is one registry entry plus a migration only if it
needs a new column.

| Kind            | Subject | Cardinality | Payload                                                  | Reviewer chain |
| --------------- | ------- | ----------- | -------------------------------------------------------- | -------------- |
| `entry`         | entry   | one         | `{}` (the lemma is a word or a lexical unit)            | Jev, then LLM; LLM alone for a phrase or a recorded inflection |
| `sense`         | sense   | one         | `{ gloss, register? }`                                   | Jev, then LLM  |
| `form`          | entry   | many        | `{ form, type, pos? }` (plural, past, variant…)          | Jev, then LLM  |
| `relation`      | sense   | many        | `{ type, target_sense_id }`                              | Jev, then LLM  |
| `pronunciation` | entry   | many        | `{ ipa, accent, strength?, pos? }` (accent `us` or `uk`) | LLM            |
| `example`       | sense   | many        | `{ text }`                                               | LLM            |
| `translation`   | sense   | many        | `{ language, text }` (BCP 47 tag)                        | LLM            |
| `topic`         | sense   | many (≤ 3)  | `{ topic_id }` (a leaf topic)                            | Jev, then LLM  |
| `grammar`       | sense   | one         | `{ countability?, transitivity?, position?, patterns? }` | Jev, then LLM  |
| `morphology`    | entry   | one         | `{ parts: [{ form, role, meaning? }] }`                  | Jev, then LLM  |
| `collocation`   | sense   | many (≤ 5)  | `{ text, pattern }`                                      | LLM            |
| `sense_list`    | entry   | one         | `{ common: [sense_id], extra: [sense_id] }`              | LLM            |

A kind with cardinality *one* admits a single live fact per subject: a sense has
one gloss, one grammar, and an entry one word formation and one sense list. Changing it means submitting a correction that supersedes the
published fact; a second gloss without `supersedes_id` is a conflict.

D1 enforces this with two partial unique indexes on `(kind, subject_id)` over
`exclusive` rows. The *holder* index covers the published fact and any pending
fact that corrects nothing; the *pending* index covers every pending fact. So a
pending correction may sit beside the published original, and a second pending
fact or a second holder is refused. A write that one of these indexes, the
live-content index, or the one-live-correction index refuses answers
`409 conflict`.

Each inflecting form type belongs to one word class. Plurals are noun forms;
past, past participle, present participle, and third-person singular are verb
forms; comparative and superlative are adjective or adverb forms. The form
question names that class, so Jev judges "breaded" against the verb "bread",
not the dominant noun. A spelling variant is asked about the word as a whole.

Relation types are `synonym`, `antonym`, `hypernym`, and `part_of`. The Jev
questions started as the ones the producer qualified. Each now says that two
senses of one word never stand in a relation, and the hypernym question also
says that mutual substitutability is synonymy, that hypernymy holds only
between nouns or between verbs, and that a generic head such as "cause" does
not count. A relation links senses of two different entries; a relation inside
one entry, or from a sense to itself, is `422 invalid_reference`. Synonyms and
antonyms are symmetric, so each is stored once per pair of senses: submission
orients it with the smaller sense id as `subject_id` and the larger as
`target_sense_id`, and a submission from the other end returns the stored fact
with `created: false`. Hypernyms and `part_of` keep the direction they were
submitted in. Reads list a relation on both senses, `outgoing` on its subject
and `incoming` on its object, and gaps count it for both. The migration
`orient_symmetric_relations` flipped stored rows into this orientation and
kept their reviews; a live mirrored pair kept both rows, and the one whose
`subject_id` is larger is the duplicate to retract. A relation is reviewed with
the relation question only. Whether each sense is an established meaning is the
job of that sense's own `sense` fact, and the relation stays hidden until both
are published.

### Topics

Learners find words by topic: the scene they need them in ("words I need at
the hospital") or the subject area they belong to ("emotions"). The server keeps a two-level controlled taxonomy in the `topics`
table (`id`, `parent_id`, `name_en`, `name_zh`, `position`): 16 categories
(`parent_id` null), such as `body-health` "Body and health", over 147 leaf
topics, such as `hospital-doctor` "At the doctor and hospital". Ids are stable;
names are display labels; `position` orders siblings. The owner curates it, so
it changes only by migration (`topics_seed` inserted the approved taxonomy);
agents cannot create topics.

A `topic` fact tags one sense with one leaf topic. Topics are tags, not
relations between words: a relation to an "anchor word" would need an anchor
that is itself ambiguous, a fuzzy "related to" type that review cannot judge,
and would count toward the relations gap; a tag points into a fixed hierarchy
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
  correction takes its place: a weak topic on a full sense is fixed by a
  correction. A fact has at most one live correction, and a correction goes
  live only while its original is published (invariants I1 and I2 under the
  fact lifecycle), so a correction and its original never both publish.

The content key is the topic id, so resubmitting a tag returns the live fact.
Jev is asked one question (`topic`):

> Does a learner of English commonly meet or need "*lemma*" (*pos*), meaning
> "*gloss*", when dealing with or talking about the topic "*topic name*" (in
> the category "*category name*")? Judge this sense only, not other senses of
> the word. A loose association, or a word that only turns up incidentally in
> this topic as it does in many others, does not count.

The LLM second opinion passes a sense a learner would commonly meet or need
when dealing with or talking about the topic, whether the topic is a scene (at
the hospital) or a subject area (emotions, colours and shapes). It fails a loose
association, a topic that fits a different sense of the word, or a topic in
which the word only turns up incidentally. It sees the
entry's other senses. A topic fact is judged against the gloss, so a gloss
correction that changes its meaning revalidates it like examples,
translations, and relations.

`GET /v1/topics` returns `{ categories: [{ id, name_en, name_zh, topics: [{ id,
name_en, name_zh }] }] }` in display order. `GET /v1/topics/{id}/senses`
returns a keyset page `{ items: [{ id, lemma, pos, gloss }], next_cursor }` of
the senses that published topic facts tag with that leaf, or with any leaf of
that category, each sense once, in lemma then sense-id order. A sense appears
only while its topic fact, its gloss, and its entry are published. An unknown
id is `404 not_found`, without a fuzzy fallback. The query starts from the topic
facts through the live-content index, so only the tagged senses are sorted.
The public entry lists each sense's `topics` as `{ id, confidence, verdict,
topic_id }`, and topic facts appear wherever the management API lists facts.

### Write rules

Submissions (`POST /manage/v1/facts` and `POST /manage/v1/senses`) enforce
these formats in `shared/facts.ts`. A violation is `400 invalid_request` whose
message names each rule the payload breaks. Stored facts are read with the
plain payload shape, so facts written before a rule still read.

- **Gloss.** 6 to 300 characters after trimming. It starts with a capital
  letter, a digit, a quote, or `(`, and ends with a period. It holds no
  example: no `as in`, `e.g.`, `for example`, or `for instance`, and no quoted
  sentence (a quoted span that ends in `.`, `!`, or `?`). Examples are
  `example` facts. Quoted single words or set phrases, such as "usually
  followed by 'for'", are usage notes and pass.
- **IPA.** One broad transcription: no commas, semicolons, slashes, brackets,
  parentheses, or `|`. Each symbol is from the broad English IPA set
  (`aeiouæɑɒɐɔəɚɛɜɝɪʊʌɨɵʉ`, `bdfhjklmnprstvwzðθʃʒŋɡʔɾɫʍxç`, `ˈ ˌ ː ˑ .`,
  space, and `ʰ ʷ ᵊ`, syllabic, non-syllabic, nasal, and tie marks). One
  spelling per sound keeps transcriptions comparable: `r`, not `ɹ`; `ɡ`, not
  `g`; `ˈ` and `ː`, not `'` and `:`; `tʃ` and `dʒ`, not ligatures. The message
  names each symbol to replace.

- **Grammar.** At least one property, each pattern once.
- **Word formation.** Parts in written order: prefixes, then at least one base or
  root, then suffixes. A prefix is letters ending in a hyphen (`un-`), a suffix a
  hyphen followed by letters (`-ness`), a root letters only (`spect`), and a base a
  word (`happy`, or one with an inner hyphen or apostrophe). One part is a simple
  word, so its role is `base`.
- **Collocation.** At least two words.
- **Sense list.** At least one common sense, and each sense named once, in
  `common` or in `extra`.

#### Grammar, word formation, and collocations

`grammar` is what a learner needs to use a sense in a sentence. Its properties
depend on the sense's part of speech, which a submission is checked against:

| Part of speech | Properties                                                         |
| -------------- | ------------------------------------------------------------------ |
| noun           | `countability` (required): `countable`, `uncountable`, or `both`   |
| verb           | `transitivity` (required): `transitive`, `intransitive`, or `both`; `patterns` |
| adjective      | `position`: `attributive_only` or `predicative_only` (absent means both); `patterns` |

`patterns` lists the common constructions that follow the word, not all of
them: `to_infinitive`, `bare_infinitive`, `ing_form`, `that_clause`,
`wh_clause`, `object_to_infinitive`, `object_bare_infinitive`, `object_ing`,
`two_objects`, `object_complement`, and `preposition` for verbs; adjectives take
`to_infinitive`, `ing_form`, `that_clause`, `wh_clause`, and `preposition`.
Grammar about any other part of speech is refused by the registry's
`subjectPos`, as a topic on a function word is. A property the part of speech
does not take, a missing required one, or a pattern it does not take is
`422 invalid_reference` with a message naming what to change. Its content key is
its properties in a fixed order with sorted patterns.

`morphology` is an entry's word formation as a learner's dictionary gives it:
a simple word is one `base` part (`water`), a derived word names its base and
affixes (`unhappiness` = `un-` + `happy` + `-ness`), and a Latin or Greek root
may carry a short meaning (`spectator` = `spect` "look" + `-ator`). Roles are
`prefix`, `root`, `suffix`, and `base`. A phrase has no word formation: a
morphology fact about a multiword entry is `422 invalid_reference`. The check
of the parts is light: their letters, without hyphens and apostrophes and
ignoring case, must spell the lemma within two changed letters for each place
two parts join (`happy` + `-ness` gives *happiness*, `decide` + `-ion`
*decision*); otherwise it is `422`. Whether the parts are the real formation is
review's job. Its content key is each part's role, form, and meaning in order.

`collocation` is a combination native speakers commonly use with a sense, such
as *make a decision*. `pattern` is `verb_noun`, `adjective_noun`, `noun_noun`,
`adverb_adjective`, `verb_adverb`, `verb_preposition`, `noun_preposition`,
`adjective_preposition`, or `phrase`. Its text must contain the lemma, or the
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

#### Sense lists

`sense_list` says which of an entry's senses a learner needs and in what order.
`common` holds the common, general-knowledge senses a learner's dictionary
(Oxford Advanced Learner's, Longman, Cambridge) lists, most common first across
parts of speech; `extra` holds the entry's other live senses: rare, archaic,
Old English, technical, or specialist ones. Rare senses may exist and can be
added at any time, but they never count toward completeness. The list must name
exactly the entry's live senses (those whose gloss is live): a sense that is not
one, or a live sense it leaves out, is `422 invalid_reference`, and the message
names those sense ids. Its content key is the `common` ids in order and the
`extra` ids sorted, so resubmitting the same list, or one that only reorders
`extra`, returns the live one. The rule is checked after the dedupe, like every
`admit` rule. A changed list is a correction that supersedes the published one.

A list is decided with the senses it names, so it goes stale when they change:
a new sense that it does not name, or a listed sense whose gloss is rejected or
retracted. Then the entry's `sense_list` gap reopens (see Gaps) and the producer
submits a correction naming the senses as they are. Correcting a gloss does not
re-review the list.

A rejected list is feedback the producer acts on. Its review reason names each
missing sense, duplicate pair, misordered sense, and misplaced sense, and the
`sense_list` gap carries `rejected`: how many of the entry's lists naming
exactly its live senses review rejected, counted up to
`MAX_SENSE_LIST_ATTEMPTS - 1` (`MAX_SENSE_LIST_ATTEMPTS` is 3, in
`server/domain/work.ts`). Each rejection below the bound changes the gap, so the
open work differs from what the last claim recorded, the entry is not stalled,
and the next pass reads the latest rejected list's reason among the claim's
entry facts and fixes exactly what it names. The third rejected list of the
same senses leaves the gap as the claim found it, so the entry stalls (see
Stall). A change to the senses starts the count over, since earlier lists no
longer name exactly the live senses. A sense another principal authored cannot
be retracted by the producer (retract is author-only), so a duplicate the
reviewer names among such senses goes through feedback or an admin.

The public entry (`GET /v1/entries/{lemma}`) shows its published word formation
as `morphology`, and each public sense (also `GET /v1/senses/{id}`) its
published `grammar` and `collocations`, each with its id, confidence, and
verdict. A kind of cardinality *one* reads `null` when nothing is published.
The entry's `senses` come in the order of its published sense list: `common`
in order, then `extra` in the order given, then any sense the list does not
name (one added since). Each sense carries `common`: `true` for a common sense,
`false` for an extra one, and `null` when the published list does not name it or
there is none; without a list the senses keep their creation order. The entry
carries `sense_list` with the published list's id, confidence, and verdict, or
`null`, so feedback can target it.

Labels are optional, and absent means unlabelled:

| Kind            | Label       | Values                                                                 |
| --------------- | ----------- | ---------------------------------------------------------------------- |
| `sense`         | `register`  | `informal`, `slang`, `taboo`, `literary`, `formal`, `dated`, `offensive`, `technical` |
| `form`          | `pos`       | The part of speech the form inflects: `would` is the `auxiliary` past of *will*, `willed` the `verb` past |
| `pronunciation` | `strength`  | `strong` (absent means strong) or `weak`, the unstressed form of a function word such as /tə/ for *to* |
| `pronunciation` | `pos`       | The part of speech a pronunciation belongs to, such as the noun *do* /doʊ/ |

A weak form must carry `strength: weak`; the LLM reviewer is told which form
it judges and rejects a weak form submitted as the strong one. A form's `pos`
replaces the word class in its Jev question and in the LLM second opinion, so
both judge the labelled claim. A pronunciation's `pos` is named in its prompt,
and a sense's `register` in its Jev question and its LLM second opinion ("used
in a formal register"), so a wrong label fails review. The public entry shows
every label. A sense's `register` is part of its content key, so a correction
that only adds or changes a register is a new fact that supersedes the gloss. It
is not part of the sense's identity or its meaning (see Nodes and revalidation).
A form's or pronunciation's labels are not:
the same form or transcription with another label returns the live fact, and
relabelling one means retracting it and submitting the labelled fact.

### Fact lifecycle

```
           submit
             │
             ▼
         ┌────────┐  review fail              ┌──────────┐
         │pending │──────────────────────────▶│ rejected │
         └────────┘                           └──────────┘
             │ review pass/uncertain                ▲
             ▼                                      │ revalidation fail
        ┌──────────┐────────────────────────────────┘
        │published │◀─┐ revalidation pass/uncertain
        └──────────┘──┘
           │    │ correction published    ┌────────────┐
           │    └────────────────────────▶│ superseded │
           │ retract                      └────────────┘
           ▼
        ┌──────────┐
        │retracted │
        └──────────┘

(Retract also applies to pending facts. Admin re-review returns published or
rejected facts to pending.)
```

The transition table lives in the domain. Review writes are conditional on
`status = 'pending'`, so a duplicate queue delivery cannot change a decided fact.
A correction (`supersedes_id`) is reviewed like any fact. When it publishes,
the superseded fact changes status in the same D1 batch: the original leaves
`published` first, and only while the correction is still pending, then the
correction enters it. A rejected correction leaves the original published.

A correction of a sense's gloss changes the meaning that the sense's examples,
translations, relations (as subject or object), grammar, and collocations were
judged against. The
registry lists these as the `sense` kind's `revalidates` kinds. Only a change of
meaning revalidates them: the registry's `meaningKey` for a gloss is its text
without the register, and a correction with the same meaning key as the gloss it
supersedes (a relabel) publishes without touching its dependents, pending or
published. In the same batch that publishes a correction that changes the
meaning, every live fact of those kinds about the sense gets `revalidate_since`,
and then each is enqueued. A published one stays
published and public while it waits. Its review is the *revalidation* event of
the transition table: pass or uncertain keeps it published with the new review
(`reconfirm`), and fail moves it to `rejected` (`invalidate`). If the gloss is
gone by the time the job runs (the correction was retracted while its
dependents waited), no reviewer is asked: the fact stays published with its
standing review and only loses the mark (`release`). The mode table maps this
`unreviewable` finding to `reject` for a first review and to `release` for a
revalidation. Every review write is
conditional on the mark the review read, no mark included, and every
transition clears the mark, so a duplicate delivery or a review that a newer
correction overtook changes nothing. That also covers a pending dependent: if
a correction publishes while its first review is judging the old gloss, the
correction marks it, the stale write finds the mark and is discarded, and the
enqueued job reviews it against the new gloss. Retracting a gloss does not cascade: the sense leaves the public view,
and that already hides its facts.

An author can retract its own pending or published fact; admins can retract
any. An admin can re-review a published or rejected fact: it returns to
`pending` and is enqueued, unless that would make a second live fact with the
same content or in the same exclusive slot. Re-reviewing a fact while a live
(pending or published) correction supersedes it, a rejected fact whose place
another live fact took, or a rejected correction whose original is no longer
published (another correction superseded it, or it was retracted), answers
`409 conflict`, and so does a rejected correction whose original already has
another live correction. The reset applies only to the status it read, and
every one of these rules is a condition of the reset `UPDATE` itself, so none
can race another write.

A correction publishes even when its original left `published` while it was
pending (retracted, or rejected by a revalidation); it then stands on its own
and retires nothing.

Two invariants keep a correction in exactly its original's place. Each holds by
construction in a single statement, never by a read before the write; D1
runs statements one at a time, so no write can land between a check and the
write it guards.

- **I1. A live correction's original is published or has left live.** A
  correction enters `pending` only by its insert or by the re-review reset of a
  rejected correction. Both carry `EXISTS (original id = supersedes_id AND
  status = 'published')` in the same statement. The original side is the
  re-review reset, the only way a fact re-enters `pending`: it carries `NOT
  EXISTS (a live fact whose supersedes_id is this one)`. An original that left
  live (superseded, retracted, or rejected) never comes back while its
  correction is live, so it is never `pending` beside one. A refused correction
  write is `409 conflict` with "Only a published fact can be superseded".
- **I2. A fact has at most one live correction.** The partial unique index
  `facts_live_correction_idx` on `supersedes_id` over live rows refuses a
  second one. A submission is `409 conflict` with "The fact this corrects
  already has a live correction", and so is re-reviewing a rejected correction
  beside a live one.

With both, a kind's `maxLive` limit holds for published facts. The insert and
the revival of a rejected fact count the live facts of the kind except the
fact being corrected. Each live correction has its own original (I2), and that
original is not counted only while it is published or out of live (I1). The
correction publishes in the batch that retires its published original, and the
original cannot become `pending` again, and so cannot publish, while its
correction is live. A correction and its original are therefore never
published together, and the published facts of a kind never exceed the limit.
The use cases still read the original first and again after a refused write,
but only to choose the message.

### Reviews

- **Jev** gets typed `noul` questions at `POST {MODEL_BASE_URL}/v1/systemone`
  and returns a probability per question. Every answer at or above 0.8 is
  `pass`, any answer below 0.5 is `fail`, anything else is `uncertain`.
  Confidence is the minimum answer.
- **LLM** gets a rubric prompt at the OpenAI-compatible chat completions
  endpoint and must return JSON `{ verdict, confidence, reason }`.
- **Second opinion.** Each kind names its reviewer chain in the registry, and
  `server/domain/review-chain.ts` says which verdicts settle a fact: Jev
  settles only `pass`, and the LLM settles every verdict. A plan asks its
  kind's whole chain, or the LLM alone for a subject Jev misjudges; the LLM
  ends every chain, so a plan may skip the reviewers before it, never it. When Jev fails or is
  unsure about an entry, sense, form, relation, or topic, the LLM judges the same
  claim with a kind-specific rubric and decides: pass or uncertain publishes
  with the LLM's verdict and confidence, fail rejects. The rubric gets the
  lemma, the part of speech, and the entry's other senses; for a relation it
  gets both senses and also fails a relation whose type is not the most
  accurate one (a mutually substitutable pair is a synonym, not a hypernym).
  The relation rubric treats glosses as short paraphrases: it judges the
  relation between the words in those senses and does not fail a pair over a
  detail one gloss mentions and the other omits, such as a transitive use or
  an extension in time. `part_of` needs a distinct component or region of
  the whole; a material or ingredient it is made from, or a generic
  part such as a back or side, is not one.
- **Entry admission.** A single-word lemma passes as an established word: a
  dictionary lemma, function word, or established abbreviation, not an
  ordinary inflection, proper name, misspelling, or invented word. A letter of
  the alphabet is not a word: a lemma of exactly one Unicode letter other than
  the words "a" and "I" is planned as `unreviewable`, so its first review
  rejects it without asking a reviewer. Abbreviations of two or more letters
  are reviewed as before. A
  multiword lemma (one containing whitespace) goes to the LLM alone, with its
  own rubric, and passes only as a lexical unit: its meaning is not the sum of its
  parts (an idiom such as "bear fruit", a compound naming one thing such as
  "red blood cell"), it is a phrasal verb or fixed grammatical phrase even
  when transparent ("end up", "sit down", "in front of"), or it is the
  everyday name of one kind of thing or place that speakers learn as a whole
  ("post office", "bus stop"). A phrase that meets none of these fails, such
  as a descriptive phrase built from the plain meanings of its words, even a
  common one ("wheat grain", "tooth root", "white rice"), or a coined
  category label ("time unit", "plant part"). The test is about the phrase itself: reviewers
  cannot consult dictionaries, and no external word list is used, because
  lists such as WordNet include exactly those category labels. Jev does not
  judge phrases: over 1,061 multiword entries it settled 314 passes on its
  own, among them descriptive phrases the rubric fails ("spatial
  distribution", "mountain system", "scientific law").
- **CEFR evidence.** The CEFR learner vocabulary lists (see Reference data)
  are an authority that a headword is vocabulary learners need; the lexical-unit
  test rejected about half of the multiword entries the lists name ("mental
  health", "weather forecast", "get changed"). When `lemma_cefr` lists the exact
  lemma, the entry review carries the listings in its context (`cefr`: each
  level, part of speech, and source name, read in one indexed lookup) and the
  LLM rubric replaces the admission criteria with that evidence: the headword
  passes unless it is nothing but an inflected form of another word (a
  headword with uses of its own, such as "could" or "best", passes), a proper
  name, or a misspelling, and a phrase is not asked whether it is a lexical unit. The plan
  is unchanged: a phrase goes to the LLM alone, a single word to Jev and then
  the LLM unless an inflection is recorded, and a listed single word's LLM
  rubric carries the evidence when it is asked. A lemma no list names (an
  agent-created neighbor) keeps the criteria above.
- **Recorded inflections.** Jev also passed bare inflections as words ("is"
  at 0.99, "was", "has", "did"). When another entry whose entry fact is live
  holds a live form of any type but `variant` spelled like the lemma, the
  entry review carries those entries in its context (`inflectionOf`: each
  entry's lemma and the form type) and goes to the LLM alone. The rubric names
  them and passes the word only when it also has uses of its own as a
  lemma ("saw" the tool besides the past of "see", "left" the side, "found" to
  establish, "better" to improve); it fails a bare inflection. The entry's own
  forms ("sheep" as the plural of "sheep") and spelling variants are no
  evidence. No deterministic rule can reject instead: entries are reviewed
  before any sense exists, so the data cannot tell "is" from "saw". The
  evidence is read when the entry is reviewed, so the check is made
  independent of order: the registry's `rereviews` names, for a form of any
  type but `variant`, the other entry spelled like the form whose published
  `entry` fact Jev settled alone (`review.reviewer` = `jev`). In the same batch
  that publishes the form, that fact gets `revalidate_since` unless it already
  has one, and then it is enqueued; its revalidation goes to the LLM alone with
  the inflection evidence, so a bare inflection such as "went" or "took" that
  passed on Jev before its base word's forms existed is rejected
  (`invalidate`), and a headword with uses of its own ("could", "best",
  "left") keeps its place (`reconfirm`). A review that loaded its context
  before a form published can still settle on Jev without the evidence; the
  window is one review, and the form's later publishes do not reopen it. A duplicate
  delivery of the form's review publishes nothing and marks nothing; an entry
  the LLM judged is not reopened; at most one entry fact is marked per form,
  the one of the exact lemma.
- **Relation floor.** A relation request carries `settlesFailBelow` 0.15: a Jev
  answer under it settles the fail without asking the LLM. In the audit, every
  relation the LLM published over a Jev answer that low was wrong (shore
  `part_of` key at 0.09, back `part_of` heart at 0.06), while the lowest correct
  one it rescued scored 0.21. Other kinds have no floor: the LLM correctly
  published the plural "stone" over a Jev answer of 0.07.
  Jev's fail band rejected correct facts and its uncertain band published
  relations of the wrong type, which is why it no longer decides those bands
  alone. The review's `reviewer` is `jev+llm`, `model` joins both models,
  `reason` joins both reasons, and `detail.opinions` keeps both opinions.
- **Translations** are judged as a bilingual learner's dictionary would. A
  verb-like or descriptive rendering of a preposition, adverb, or particle,
  and a bracketed usage note such as （表示…）, pass when they convey the sense.
  Chinese does not mark part of speech, so a noun sense may be rendered by an
  equivalent that also reads as a verb or adjective, or by a phrase naming the
  same act, event, or state (腹泻；拉肚子 for "run" meaning diarrhoea). A wrong
  meaning, a different sense, a noun-only equivalent of a verb sense,
  unnatural wording, or equivalents of unrelated senses fail.
- **Grammar** asks Jev one yes/no question per property and per pattern, each
  about the sense only ("Consider the English verb "run" only in the sense …,
  not in any other sense. Is it intransitive: it never takes a direct object?").
  The questions are keyed `countability`, `transitivity`, `position`, and
  `pattern_<name>`, and each pattern names an illustration ("decide to leave"
  for a verb, "happy to help" for an adjective). The LLM second opinion lists
  every claim, as the Oxford Advanced Learner's, Longman, or Cambridge would
  mark the sense: it passes when each claim holds for this sense, fails a claim
  that is wrong or holds only for another sense, or a pattern that is rare or
  unnatural with it, and does not fail a pattern left out.
- **Word formation** asks Jev whether the word is formed from exactly these
  parts with these meanings, as a learner's dictionary analyses it, with no
  part missing or extra and no folk etymology; one base part asks whether the
  word is a simple word. The LLM rubric allows spelling changes where parts
  join and fails a wrong, missing, or extra part, a wrong meaning, folk
  etymology, letters that only look like an affix (the "er" of "water"), and a
  word claimed simple that has parts.
- **Collocations** go to the LLM alone, like examples: is the text a
  collocation of this sense that a learner's dictionary of collocations would
  list, in the claimed pattern? It fails a free combination anyone composes
  from the plain meanings ("a nice decision"), a combination that uses another
  sense of the word (the entry's other senses are listed), rare, unnatural, or
  ungrammatical wording, and the wrong pattern.
- **Sense lists** go to the LLM alone: no Jev question can judge a whole
  inventory. The rubric gives the lemma and every listed sense with its part of
  speech and gloss, numbered, the common senses in their claimed order and then
  the extra ones, and passes only when all of these hold: the common senses
  cover every common, general-knowledge sense a learner's dictionary (Oxford
  Advanced Learner's, Longman, Cambridge) lists for the word, in every part of
  speech, so a missing common sense fails; no two common senses are duplicates
  or one meaning split too finely; the common senses run from most to least
  common; and every extra sense is genuinely rare, archaic, technical, or
  specialist. A rare, archaic, Old English, technical, or specialist sense
  missing from both lists is never a failure. The reason of a fail names
  everything to change, even past one sentence: each missing common sense with
  its part of speech and a short meaning, each pair of duplicates by number,
  each sense out of order, and each common sense put in extra, so the producer
  can add, merge, or reorder senses and submit a corrected list. A list that
  names a sense without a live gloss is `unreviewable` and rejected without
  asking the LLM. The entry review context carries each sense's id for this.
- **Examples** of vulgar, offensive, or derogatory senses are judged as
  illustrations of that sense: a sentence that shows the sense in ordinary use
  passes, and one that adds offence the sense does not need, such as abuse of
  a whole group, fails. The shared LLM instructions fail what is wrong or
  misleading, not what is offensive.
- The review stores the context it judged (lemmas and glosses of referenced
  senses, and the entry's other senses) so a later reader knows what was
  approved.
- A sense's current gloss is its published `sense` fact, or until one
  publishes, its pending one. That keeps examples, translations, and relations
  from waiting on the gloss. A meaning-dependent fact whose sense has no live
  gloss at all is rejected as unreviewable without calling a reviewer.
- A transport failure of any reviewer in the chain is not a verdict. The fact
  stays `pending`, and the queue retries the whole chain.

## Feedback

Anyone can report a problem with an entry, a sense, or a fact through the
public API. The target must be publicly visible under the read rules above;
anything else is `404 not_found`. Each client address (`CF-Connecting-IP`) may
send 10 reports a minute through the `FEEDBACK_RATE_LIMITER` binding; more is
`429 rate_limited`. Feedback moves through `open → claimed → resolved | dismissed`.
An agent claims a feedback item with a one-hour lease, so two agents do not
work the same report. An expired claim can be claimed again by anyone, and the
holder can renew its claim at any time. Only the holder resolves (linking the
correcting fact IDs) or dismisses (with a note). Every feedback write is a
compare-and-set on a revision counter.

## Worklist

Agents ask the server what to work on instead of keeping their own list, and a
lease keeps two agents off the same entry. Each entry carries a completeness
and a quality score, and the two scores decide what the worklist hands out:
once every entry is complete and good enough, stalled, or awaiting review, the
claim answers `204` and producers stop. An entry awaiting review comes back
once its reviews settle, within seconds, so a producer that stops on `204` may
leave such entries for its next run.

`POST /manage/v1/work/claim` (body `{ lease_seconds? }`, 60 to 3600, default
900) leases one entry to the caller and returns
`{ lease, entry, gaps, weak_facts }`: the lease (`id`, `entry_id`, `lemma`,
`holder`, `expires_at`), the same management view `GET /manage/v1/entries/{lemma}`
returns, the entry's gaps, and its weak facts. The management view carries
`seed`, `completeness`, and `quality`, so an agent reads them from the server
instead of keeping its own copy. It answers `204` when no entry is claimable.

### Scores

Both scores are pure functions of the entry's facts in `server/domain/work.ts`
(`assessEntry`), computed on read for the views and stored on the worklist for
the claim.

**Completeness** (0..1) is filled slots over the slots the gap rules count. The
entry has three slots (the sense inventory, forms, pronunciation), and a
single-word entry a fourth (word formation); each counted sense adds the
relations, topics, grammar, and collocations its part of speech needs, one
example, and one `zh` translation. A counted sense is one whose gloss is live and
that the entry's current sense list does not put in `extra`; before a list
exists, every sense with a live gloss counts. A relations gap with `count`
relations fills `count` of its slots. A relation counts, at either end, only
while the sense at its other end has a live gloss and its entry a live entry
fact: a relation to a sense of a rejected entry, or to a sense whose gloss was
rejected or retracted, fills nothing, as the public view shows nothing of it.
The entry snapshot already loads the senses at the other end of the entry's
relations, incoming and outgoing, with their `entry` and `sense` facts in one
batch, so the rule costs no extra query. Completeness derives from `entryGaps`,
so the gap rules stay the one
source: it is 1 exactly when there are no gaps.

**Quality** (0..1) is one minus weak facts over live facts about the entry and
its senses. A live fact is weak when an `open` or `claimed` feedback item
targets it, or when it is published on an `uncertain` review verdict. The claim
lists each as `{ id, kind, reason }` with reason `feedback` or `uncertain`, so a
producer submits a correction that supersedes it or retracts it. Feedback on an
entry or sense, not a fact, makes nothing weak: it is worked through the
feedback API. Quality is 1 exactly when no fact is weak.

### Admission and order

An entry is claimable while its entry fact is live, no unexpired lease holds
it, it is not stalled, it is not **awaiting review**, and it has work left
(completeness or quality below 1). An entry awaits review while any fact about
it or its senses, or any relation into one of its senses, is `pending`. Such a
review can still change the entry's open work, so a pass claimed before it
lands would record open work the verdict then undoes (see Stall). The queue
reviews within seconds and the cron re-enqueues stuck facts, so the entry comes
back once the reviews settle (`isClaimable`).

Claimable entries come in the order a learner needs them: the words a learner
must master first, and completeness before quality (`claimTier`):

1. **Gaps before weak facts.** An entry with a gap (completeness below 1) comes
   before every entry whose only work is weak facts (completeness 1, quality
   below 1), so the dictionary fills before it polishes.
2. **Learner band.** Within each, entries come by the lowest CEFR level of their
   exact lemma, A1, A2, B1, B2, C1, then C2; then entries with a frequency but no
   level; then the rest, such as neighbors an agent created that neither list
   knows.
3. **Never-claimed before claimed.** Within a band, never-claimed entries come
   first, by highest Zipf frequency (an entry without one last), then lowest
   completeness; claimed entries follow by least recently claimed. Then by
   creation time and id.

| `claim_rank` | Entries                                                      |
| ------------ | ------------------------------------------------------------ |
| 0, 1         | A gap, A1: never claimed, claimed                            |
| 2 … 11       | A gap, A2 to C2, two ranks per level                         |
| 12, 13       | A gap, a frequency but no CEFR level                         |
| 14, 15       | A gap, neither                                               |
| 16 … 31      | Only weak facts, in the same bands                           |

A seed entry comes from a curated word list: the 850 Basic English words, and
the CEFR headwords the core import creates (see Reference data). `POST
/manage/v1/entries` with `seed: true` marks the entry as a seed entry, whether
the call creates it or it already exists. The mark only ever goes on: `seed:
false` or no `seed` leaves it as it is. The management view shows it, but it no
longer orders the claim: a seed entry and an agent's neighbor with the same level
and frequency are claimed alike. Of the 850 Basic English entries, 829 have a
CEFR level and all have a frequency, so they sit in the bands they belong to.

Every claim sets `claimed_at`, so an entry leaves the never-claimed part of its
band and moves to the back of the claimed part whether or not its work
completes. A lease that lapses does not stall the entry: an agent that crashes on
one entry gets it again only after every other entry of its band claimed less
recently, however incomplete or frequent the crashing entry is. The claimed part
of a band still comes before the next band, so an A1 entry with work left is
claimed again before any A2 entry. Finished entries are not rotated: an entry
with no work left is never claimed.

### Stall

One claim is one pass. When the claim is made, the worklist records the entry's
*open work* (`claimed_work`): its gaps, and each weak fact by kind, subject, and
reason. The entry is **stalled** while the last claim's pass completed and the
open work is still what the claim found (`isStalled`). That covers every pass
that made no lasting progress, which the next pass would repeat:

- a pass that added nothing, or only facts no gap needed, such as a second
  example where one exists;
- a pass whose facts review then rejects: the rejection puts the open work back
  to the claim's, so a relation that keeps failing review is tried once. The
  entry awaits review from the pass's end until the verdict, so no other pass
  records the pending fact's open work in between and turns the rejection into
  a change;
- a pass that superseded a weak fact with a correction that is weak again,
  since the weak slot keeps its key.

A rejected sense list is the exception, bounded: its rejection changes the
`sense_list` gap's `rejected` count, so the entry comes back for the producer to
act on the reason, until `MAX_SENSE_LIST_ATTEMPTS` lists of the same senses are
rejected (see Sense lists).

The open work changes, and the stall lifts, when another principal fills or
opens a gap, a fact leaves live, a weak fact is replaced, a new sense opens
gaps (its own and a stale sense list's), or feedback opens on a fact. A pass that adds a sense makes progress: its
gaps are new work for the next pass. A word whose relations no agent can find
stalls after one pass and comes back only when something about it changes.

### Relations by part of speech

The relation types (`synonym`, `antonym`, `hypernym`, `part_of`) fit content
words. On seed entries claimed at least three times, the share of senses with
two published relations was noun 90%, adjective 75%, verb 72%, adverb 35%,
determiner 28%, preposition 23%, conjunction 20%, interjection 19%,
auxiliary 13%, and pronoun 11%. `RELATIONS_NEEDED` in `server/domain/work.ts`
is the one table of the relations a sense needs: noun, verb, and adjective 2;
adverb 1; every other part of speech 0, which means no relations gap and no
relation slots.

`TOPICS_NEEDED` is the table of the topics a sense needs: noun, verb, and
adjective 1; every other part of speech 0, which means no topics gap and no
topic slot. Nouns, verbs, and adjectives name the things, actions, and
qualities a scene is made of. An adverb may carry topics but needs none.
General-vocabulary senses (*get*, *make*, *thing*, *important*) belong to no
topic, so they are expected to stay untagged: their topics gap stays open and
the entry stalls after one pass.

### Grammar, collocations, and word formation

`GRAMMAR_NEEDED` and `COLLOCATIONS_NEEDED` in `server/domain/work.ts` are the
tables of what a sense needs, like `RELATIONS_NEEDED`. Noun and verb senses
need one grammar fact: countability and transitivity are what a learner most
needs of them. An adjective may have grammar, where its position or patterns
restrict it, but has no grammar gap. Noun, verb, and adjective senses need one
collocation; other parts of speech none. A single-word entry needs one word
formation; a phrase none, since its words are their own entries.

### The worklist table

`worklist` holds one row per entry, written in the same batch as the entry:

| Column                                            | Meaning                                                    |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `entry_id`, `created_at`                          | The entry and its creation time                            |
| `live`                                            | The entry fact is pending or published                     |
| `claimed_at`                                      | When the entry was last claimed; null until the first claim |
| `seed`                                            | The entry was submitted as part of a seed list             |
| `frequency_key`                                   | `frequencyKey` of the lemma, written with the row          |
| `level_rank`, `zipf`                              | The learner priority: 1 (A1) to 6 (C2) for the lowest CEFR level of the exact lemma, and the Zipf frequency of `frequency_key`; null when the reference data has none |
| `completeness`, `quality`, `stalled`              | The scores and the stall, as of `scored_revision`          |
| `awaiting_review`                                 | A fact about the entry or its senses, or a relation into one of its senses, is pending, as of `scored_revision` |
| `claimed_work`                                    | The open work the last claim found                         |
| `revision`, `scored_revision`                     | Bumped by every write that can change the entry's work; the revision the scores describe |
| `claim_rank`                                      | Generated: `claimTier` of a claimable entry, else null; a stale row counts as claimable and its stored completeness picks gaps or weak facts |
| `lease_id` (unique), `lease_holder`, `lease_expires_at` | The current or last lease; all set or all null      |
| `last_worked_at`, `last_worked_by`, `last_note`   | The last completed work                                    |

Every write that can change an entry's gaps or weak facts bumps `revision` of
the entries at both ends in its own batch: a fact insert or status change
(review, retraction, re-review, supersede), a sense insert, a feedback insert or
status change on a fact, and a completion. A write that moves an `entry` or
`sense` fact into or out of live (an insert, a rejection, a retraction, a
supersede, a re-review of a rejected fact) also bumps the entries whose
relations link to the senses that fact defines, since their relations gaps
depend on it. The use case that made the write then rescores the stale rows it
touched, linked entries included (`refreshWork`): it loads the entry, assesses
it, and stores the scores and the stall conditional on `revision` being
unchanged, so a concurrent write's rescore wins instead of being overwritten. A
stale row stays claimable, so a request that crashed before its rescore never
hides work; the cron rescores up to 100 stale rows every run
(`refreshStaleWork`). It tries every row of the batch before it throws the
failures together, so a row that keeps failing holds one slot and the rows
behind it still drain. Every fact insert or status change also rewrites `live`
for its subject.

The claim is one `UPDATE … WHERE entry_id = (SELECT … WHERE claim_rank IS NOT
NULL ORDER BY claim_rank, claimed_at, zipf DESC, completeness, created_at,
entry_id LIMIT 1) RETURNING` statement that picks the entry, writes the lease,
and stamps `claimed_at`; the claim then records `claimed_work`. Never-claimed
rows have a null `claimed_at`, so their order falls to frequency, where SQLite
sorts null last in descending order, and then completeness. The index
`(claim_rank, claimed_at, zipf DESC, completeness, created_at, entry_id)` gives
that order without a sort, and the scan passes at most one row per held lease before a free row. D1
runs statements one at a time, so two concurrent claims never get the same
entry, and a claim takes over a lease only once it has expired. Work state
lives in this table, not on the `entries` node, which keeps identity only.

The migration `worklist_drop_revisit` removed the revisit marks, streak, and
claim count that ordered the earlier rotation, and `worklist_scores_backfill`
computed every entry's completeness, quality, and `awaiting_review` in SQL by
the same rules, aggregating per entry once over the indexed fact lookups; no
entry starts stalled.

Topics gaps opened on every live noun, verb, and adjective sense at once, so
`worklist_topics_scores` recomputed every entry's completeness in SQL by the
rules above, topics included, in one aggregating statement instead of marking
every row stale for the cron to drain 100 at a time (a stale row is claimable,
so finished entries would have been handed out meanwhile). The same statement
lifts the stall of an entry with an open topics gap whose `claimed_work` names
no topics gap: its open work changed, as `isStalled` would find on the next
rescore. `worklist_usage_scores` did the same when grammar, collocations, and
word formation gaps opened: it recomputed every entry's completeness over every
slot, those three included, and kept an entry stalled only when none of them is
open, since no claim recorded before then named one. `worklist_relation_ends_scores`
did the same when relations to senses that cannot show stopped counting: it
recomputed every entry's completeness, counting a relation only when its other
sense has a live gloss and a live entry fact, and lifted the stall of an entry
with a sense whose relations gap is open and whose count changed, which is
exactly when its open work changed (the new count is never above the old).
`worklist_sense_list_scores` did the same when the sense inventory slot started
to need a sense list: it recomputes every entry's completeness with the
inventory slot filled only by a current list naming exactly the live senses,
and with the per-sense slots of that list's extra senses left out, and it lifts
the stall of every entry that has senses its list does not settle, since no
claim recorded before then named a `sense_list` gap (the gap's `rejected`
count enters only the open work, not completeness, so the backfill has nothing
more to compute). After that release every
entry with senses has a `sense_list` gap until a list is submitted for it. A
test runs the backfills in order over rescored rows, sense lists among them
(settled, with extra senses, stale, and with a pending correction), and expects
the same scores.

The learner priority is stored on the row so the claim stays one index scan.
The row reads it from the reference tables when it is created, in the same batch
as the entry, and every reference import ends by rereading it for every row
(`rankWorklistSql` in `server/adapters/reference-sql.ts`), so a reimport
re-ranks the worklist. CEFR is read by the exact lemma and frequency by
`frequency_key`, the rules entry reads use. `frequency_key` is stored because
SQLite's `lower()` folds only ASCII letters, while `frequencyKey` lowercases all
of Unicode. The migrations `worklist_learner_priority` (columns),
`worklist_learner_priority_backfill` (`frequency_key` as `lower(lemma)`, then
the import's update), and `worklist_learner_claim_rank` (the new `claim_rank`
and index) moved the existing rows over; the backfill's `lower()` matched
`frequencyKey` for every lemma then, since none had a non-ASCII capital. A test
scrambles the stored priority, runs the backfill, and expects the rows creation
wrote. `frequency_key` is nullable only because SQLite cannot add a `NOT NULL`
column without a default to a table with rows; every insert writes it.

### Gaps

Gaps are computed on read by a pure registry in `server/domain/work.ts` from
the entry's live (pending or published) facts. Each rule names how many live
facts close its gap:

| Gap                                      | Open while                                              |
| ---------------------------------------- | ------------------------------------------------------- |
| `{ type: "senses" }`                     | No sense has a live gloss                               |
| `{ type: "sense_list", rejected }`       | Some sense has a live gloss, and the current sense list does not name exactly the senses with a live gloss; `rejected` counts the rejected lists naming exactly those senses, up to `MAX_SENSE_LIST_ATTEMPTS - 1` |
| `{ type: "forms" }`                      | No live form                                            |
| `{ type: "pronunciation" }`              | No live pronunciation                                   |
| `{ type: "relations", sense_id, count, have }` | The sense is in fewer live relations, as subject or object, than its part of speech needs |
| `{ type: "examples", sense_id }`         | The sense has no live example                           |
| `{ type: "translations", sense_id, language: "zh" }` | The sense has no live `zh` or `zh-*` translation |
| `{ type: "topics", sense_id }`           | The sense has fewer live topic facts than its part of speech needs (`TOPICS_NEEDED`) |
| `{ type: "morphology" }`                 | A single-word entry has no live word formation          |
| `{ type: "grammar", sense_id }`          | A noun or verb sense has no live grammar fact           |
| `{ type: "collocations", sense_id }`     | A noun, verb, or adjective sense has no live collocation |

`senses` and `sense_list` are one slot, the sense inventory: its gap asks for
senses while the entry has none, and for a list once it has some. The current
sense list is the entry's live `sense_list` fact that no live correction
supersedes, so a pending correction stands for the published list it would
replace and a rejected one leaves the published list in place. It settles the
inventory while it names exactly the senses whose gloss is live; a sense added
since, or a listed sense whose gloss left live, reopens the gap. Like every gap,
a pending list fills it until its review rejects it.

Per-sense gaps apply to each counted sense: a sense whose gloss is live and that
the current list does not put in `extra`. Rare senses never count toward
completeness, so an entry is complete without examples, translations, or
relations for them. Before any list exists every sense with a live gloss
counts, and a sense the list does not name (added since) counts until a new list
places it.

Relations are the core of the dictionary, and a content-word sense with one
neighbor is a leaf, so its relations gap stays open until it has two. `count`
is the number of live relations the sense is in. `have` lists each relation
type and direction it already has once, as `{ type, direction }` with the
direction of the public `Relation` (`outgoing` when the sense is the subject).
An agent looks for the types it does not have yet instead of finding the same
kind of neighbor again. The need is the bar for the gap, not a quota: an agent
submits a relation only where one holds.

`POST /manage/v1/work/{lease_id}/complete` (body `{ note? }`, up to 500
characters) records `last_worked_at`, the holder, and the note, clears the lease,
and marks the row stale in one statement; the rescore then decides the stall.
Only the holder completes, and only before `expires_at`: another principal or an
expired lease answers `409 conflict`. A lease that is gone answers
`404 not_found`, so completing the same lease twice is a 404, and so is
completing a lease after another agent reclaimed the entry. The holder is the
principal ref (`agent:<id>` or `admin:<sub>`).

## Reference data

Word frequency and CEFR level come from external datasets, not from agents.
They are reference data with provenance: not facts, never reviewed, never part
of completeness or quality. An admin imports them offline; the Worker only
reads them. A CEFR listing is also evidence for an entry review (see Reviews,
CEFR evidence); a reimport does not reopen decided reviews.

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

`GET /v1/entries/{lemma}` and `GET /manage/v1/entries/{lemma}` carry
`frequency: { zipf, rank, source_id } | null` and `cefr: [{ pos, level,
source_id }]`. `GET /v1/sources` and `GET /manage/v1/sources` list every source
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
become `auxiliary`, and numbers and infinitive "to" are dropped. CEFR-J lists
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
lemmas) and 2,785 have CEFR levels; all 850 seed entries have a frequency and
829 have CEFR levels.

The worklist orders by CEFR level and frequency (see Admission and order). An
import ends by re-ranking every worklist row from the new tables, so the
statement that replaces the reference data also moves the claim order.

### Core entries

A learner must master the CEFR headwords first, so each becomes an entry the
agents fill. Agents do not invent seed words; the imported profiles are the
authoritative list. `POST /manage/v1/entries/core` (admins only, body `{ limit
}`, 1 to 50, default 50) creates entries for the next headwords of `lemma_cefr`
that no entry has, lowest level first and then by lemma, and answers `{ created,
skipped, remaining }`. Each goes through `createEntry` with `seed: true`, so the
entry is created by the admin, its worklist row reads its learner priority, and
its entry fact is pending and queued for review like any other: a multiword
headword ("according to") goes through the multiword entry review. A single
letter other than "a" and "I" names the letter, not a word, so it is skipped
and listed in `skipped` (`isLetterOfTheAlphabet`, the rule the entry review
applies); the current profiles list no such headword. Fifty entries per call keep a request well inside the Worker's D1
query budget. The operation is idempotent: a repeated or concurrent call finds
the lemmas that have entries by then, and once `remaining` is 0 a call creates
nothing.

After a reference import, an admin runs it until nothing remains:

```sh
until [ "$(curl -sf -X POST "$BASE/manage/v1/entries/core" \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN" -H 'content-type: application/json' \
  -d '{"limit":50}' | tee /dev/stderr | jq .remaining)" = 0 ]; do :; done
```

On a copy of the development database (6,014 entries, 850 of them seed
entries), the three migrations ran in about a second: every row got its
frequency key, 2,826 a CEFR level and 4,555 a frequency, and 829 of the 850
seed entries a level. The core import then created 6,015 entries in 121 calls
in 26 seconds against a local Worker (about 0.2 s per call of 50): 405 A1,
663 A2, 1,399 B1, 1,917 B2, 803 C1, and 828 C2, 132 of them multiword, 5,738
with a frequency; no headword was skipped. Each entry fact is queued for
review, so the queue reviews about 6,000 entries before they become claimable.
A repeated call created nothing. The worklist then held 12,029 rows: 7,841 with
a CEFR level, 1,756 with only a frequency, and 1,432 with neither.

## Access

| Surface                   | Who                  | Credential                                   |
| ------------------------- | -------------------- | -------------------------------------------- |
| `/v1/*`, `/openapi.json`, `/docs` | Everyone     | None                                         |
| `/manage/v1/*`, `/manage/openapi.json` | Agents and admins | Agent API key or admin OIDC access token |
| `/manage/v1/agents`       | Admins only          | Admin OIDC access token                      |
| Admin console (SPA)       | Admins               | OIDC Authorization Code + PKCE               |

Admins are OIDC subjects listed in `ADMIN_SUBJECTS`. Agent keys are random
secrets (`vn_agent_…`) that an admin issues. The Worker stores only their
SHA-256 hash. A valid OIDC token whose subject is not an admin gets 403. A
bearer that is not a structurally valid JWT gets 401 before the Worker contacts
the issuer; an unreachable issuer is a 500, not a bad credential.

## Console

The console is how admins watch the dictionary. It reads and acts only through
`/manage/v1` with the admin's access token.

- **Overview**: fact counts by kind and status, and open feedback.
- **Facts**: a filterable, paged list with a drawer for one fact's payload,
  author, review, and the fact it supersedes. Admins retract or re-review there.
- **Entries**: every entry in lemma order, filtered by lemma prefix, with its
  entry status, live sense count, fact counts by status, and last completed
  work, so admins watch agents fill the dictionary. It refreshes itself every 30
  seconds. `GET /manage/v1/entries` serves it: a keyset page on the unique lemma
  index. Every count starts from the page's entries and reaches their senses and
  facts through an index, so a page reads the same rows however large the
  dictionary grows. A test pins those query plans.
- **Entry inspector**: one lemma with every sense and every fact in every
  status, so pending, rejected, and uncertain data is seen in context, and its
  reference data with the attribution of each source it came from. With a sense
  list, the senses follow the current list (as the worklist reads it) and each
  shows its common rank, *Rare*, or *Not in the sense list*; the list itself is
  an entry fact whose drawer shows its review.
- **Feedback**: read-only. Claiming and resolving belong to agents.
- **Agents**: issue a key (shown once) and revoke it.

A review that is `uncertain`, or a pass below 0.8 confidence, is flagged
wherever a fact is listed: it is published with flaws, the state admins watch.
Facts and feedback name nodes by id, so `GET /manage/v1/nodes/{id}` resolves an
entry or sense id to its owning entry for linking.

The public wire format is snake_case JSON. Errors are
`{ "error": { "code", "message" } }` with stable codes; pages are
`{ items, next_cursor }` over keyset cursors with a unique tiebreaker. The
console reads its public OIDC settings from `GET /configz`.

## Runtime

- One Worker serves the API, the OpenAPI documents, and the console assets.
- D1 stores nodes, facts, the topic taxonomy, feedback, agents, work leases, and
  imported reference data.
- A Cloudflare Queue carries `{ fact_id, trace_id }` review jobs. Its consumer
  takes batches of up to 25, reviews them concurrently, and logs the trace ID.
- A cron trigger runs every five minutes and re-enqueues facts whose last
  status change is more than five minutes old and that are still `pending`, and
  published facts whose
  `revalidate_since` is more than five minutes old, so a lost enqueue cannot
  strand a fact. It keys on `updated_at`, not `created_at`, so a re-reviewed fact counts
  from its reset.
- A reviewer transport failure (network, 429, 5xx) retries the message with a
  delay; after five attempts it lands in the `vocnet-reviews-dlq` dead letter
  queue, and the cron keeps re-enqueueing the fact until review succeeds.
