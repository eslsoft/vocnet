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
| `entry`         | entry   | one         | `{}` (the lemma is a word or a lexical unit)            | Jev, then LLM  |
| `sense`         | sense   | one         | `{ gloss, register? }`                                   | Jev, then LLM  |
| `form`          | entry   | many        | `{ form, type, pos? }` (plural, past, variant…)          | Jev, then LLM  |
| `relation`      | sense   | many        | `{ type, target_sense_id }`                              | Jev, then LLM  |
| `pronunciation` | entry   | many        | `{ ipa, accent, strength?, pos? }` (accent `us` or `uk`) | LLM            |
| `example`       | sense   | many        | `{ text }`                                               | LLM            |
| `translation`   | sense   | many        | `{ language, text }` (BCP 47 tag)                        | LLM            |

A kind with cardinality *one* admits a single live fact per subject: a sense has
one gloss. Changing it means submitting a correction that supersedes the
published fact; a second gloss without `supersedes_id` is a conflict.

D1 enforces this with two partial unique indexes on `(kind, subject_id)` over
`exclusive` rows. The *holder* index covers the published fact and any pending
fact that corrects nothing; the *pending* index covers every pending fact. So a
pending correction may sit beside the published original, and a second pending
fact or a second holder is refused. A write that one of these indexes or the
live-content index refuses answers `409 conflict`.

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
translations, and relations (as subject or object) were judged against. The
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
same content or in the same exclusive slot. Re-reviewing a published gloss
while its correction is pending, a rejected fact whose place another live
fact took, or a rejected correction whose original is no longer published
(another correction superseded it, or it was retracted), answers
`409 conflict`. The last check needs no lock: a rival correction is pending
before it publishes, and while it is pending the one-pending index refuses the
reset.

### Reviews

- **Jev** gets typed `noul` questions at `POST {MODEL_BASE_URL}/v1/systemone`
  and returns a probability per question. Every answer at or above 0.8 is
  `pass`, any answer below 0.5 is `fail`, anything else is `uncertain`.
  Confidence is the minimum answer.
- **LLM** gets a rubric prompt at the OpenAI-compatible chat completions
  endpoint and must return JSON `{ verdict, confidence, reason }`.
- **Second opinion.** Each kind names its reviewer chain in the registry, and
  `server/domain/review-chain.ts` says which verdicts settle a fact: Jev
  settles only `pass`, and the LLM settles every verdict. When Jev fails or is
  unsure about an entry, sense, form, or relation, the LLM judges the same
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
  dictionary lemma, function word, letter, or established abbreviation, not
  an ordinary inflection, proper name, misspelling, or invented word. A
  multiword lemma (one containing whitespace) gets its own Jev question and
  rubric and passes only as a lexical unit: its meaning is not the sum of its
  parts (an idiom such as "bear fruit", a compound naming one thing such as
  "red blood cell"), it is a phrasal verb or fixed grammatical phrase even
  when transparent ("end up", "sit down", "in front of"), or it is the
  conventional name of one thing whose words cannot be swapped for synonyms
  ("post office", "bus stop"). A phrase that meets none of these fails,
  such as a descriptive phrase any speaker composes freely ("wheat grain",
  "oven door") or a coined category label ("time unit", "plant part"). The test is a question about the phrase itself: reviewers
  cannot consult dictionaries, and no external word list is used, because
  lists such as WordNet include exactly those category labels.
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
entry has three slots (senses, forms, pronunciation); each sense with a live
gloss adds the relations its part of speech needs, one example, and one `zh`
translation. A relations gap with `count` relations fills `count` of its
slots. Completeness derives from `entryGaps`, so the gap rules stay the one
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

Claimable entries come in four tiers. Within a never-claimed tier they come by
lowest completeness; within a claimed tier by least recently claimed; then by
creation time and id:

| Tier | Entries              | Why                                                |
| ---- | -------------------- | -------------------------------------------------- |
| 0    | Seed, never claimed  | The seed list gets its first pass first            |
| 1    | Seed, claimed        | Seed entries with work left come before expansion  |
| 2    | Not seed, never claimed | Neighbors that relations created               |
| 3    | Not seed, claimed    | Other entries with work left                       |

A seed entry comes from a curated word list, such as the 850 Basic English
words. `POST /manage/v1/entries` with `seed: true` marks the entry as a seed
entry, whether the call creates it or it already exists. The mark only ever
goes on: `seed: false` or no `seed` leaves it as it is, so a producer re-runs
its seed list to mark entries that existed before. An agent that builds
relations creates neighbor entries outside the list; they wait until no seed
entry is claimable.

Every claim sets `claimed_at`, so an entry leaves its never-claimed tier and
moves to the back of its claimed tier whether or not its work completes. A lease
that lapses does not stall the entry: an agent that crashes on one entry gets it
again only after every other entry in its tier claimed less recently, however
incomplete the crashing entry is. Finished entries are not rotated: an entry
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

The open work changes, and the stall lifts, when another principal fills or
opens a gap, a fact leaves live, a weak fact is replaced, a new sense opens
gaps, or feedback opens on a fact. A pass that adds a sense makes progress: its
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

### The worklist table

`worklist` holds one row per entry, written in the same batch as the entry:

| Column                                            | Meaning                                                    |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `entry_id`, `created_at`                          | The entry and its creation time                            |
| `live`                                            | The entry fact is pending or published                     |
| `claimed_at`                                      | When the entry was last claimed; null until the first claim |
| `seed`                                            | The entry was submitted as part of a seed list             |
| `completeness`, `quality`, `stalled`              | The scores and the stall, as of `scored_revision`          |
| `awaiting_review`                                 | A fact about the entry or its senses, or a relation into one of its senses, is pending, as of `scored_revision` |
| `claimed_work`                                    | The open work the last claim found                         |
| `revision`, `scored_revision`                     | Bumped by every write that can change the entry's work; the revision the scores describe |
| `claim_rank`                                      | Generated: the tier of a claimable entry, else null; a stale row counts as claimable |
| `lease_id` (unique), `lease_holder`, `lease_expires_at` | The current or last lease; all set or all null      |
| `last_worked_at`, `last_worked_by`, `last_note`   | The last completed work                                    |

Every write that can change an entry's gaps or weak facts bumps `revision` of
the entries at both ends in its own batch: a fact insert or status change
(review, retraction, re-review, supersede), a sense insert, a feedback insert or
status change on a fact, and a completion. The use case that made the write then
rescores the stale rows it touched (`refreshWork`): it loads the entry, assesses
it, and stores the scores and the stall conditional on `revision` being
unchanged, so a concurrent write's rescore wins instead of being overwritten. A
stale row stays claimable, so a request that crashed before its rescore never
hides work; the cron rescores up to 100 stale rows every run
(`refreshStaleWork`). It tries every row of the batch before it throws the
failures together, so a row that keeps failing holds one slot and the rows
behind it still drain. Every fact insert or status change also rewrites `live`
for its subject.

The claim is one `UPDATE … WHERE entry_id = (SELECT … WHERE claim_rank IS NOT
NULL ORDER BY claim_rank, claimed_at, completeness, created_at, entry_id LIMIT
1) RETURNING` statement that picks the entry, writes the lease, and stamps
`claimed_at`; the claim then records `claimed_work`. Never-claimed rows have a
null `claimed_at`, so their order falls to completeness. The index `(claim_rank,
claimed_at, completeness, created_at, entry_id)` gives that order without a
sort, and the scan passes at most one row per held lease before a free row. D1
runs statements one at a time, so two concurrent claims never get the same
entry, and a claim takes over a lease only once it has expired. Work state
lives in this table, not on the `entries` node, which keeps identity only.

The migration `worklist_drop_revisit` removed the revisit marks, streak, and
claim count that ordered the earlier rotation, and `worklist_scores_backfill`
computed every entry's completeness, quality, and `awaiting_review` in SQL by
the same rules, aggregating per entry once over the indexed fact lookups; no
entry starts stalled.

### Gaps

Gaps are computed on read by a pure registry in `server/domain/work.ts` from
the entry's live (pending or published) facts. Each rule names how many live
facts close its gap:

| Gap                                      | Open while                                              |
| ---------------------------------------- | ------------------------------------------------------- |
| `{ type: "senses" }`                     | No sense has a live gloss                               |
| `{ type: "forms" }`                      | No live form                                            |
| `{ type: "pronunciation" }`              | No live pronunciation                                   |
| `{ type: "relations", sense_id, count, have }` | The sense is in fewer live relations, as subject or object, than its part of speech needs |
| `{ type: "examples", sense_id }`         | The sense has no live example                           |
| `{ type: "translations", sense_id, language: "zh" }` | The sense has no live `zh` or `zh-*` translation |

Per-sense gaps apply to each sense whose gloss is live.

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
  status, so pending, rejected, and uncertain data is seen in context.
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
- D1 stores nodes, facts, feedback, agents, and work leases.
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
