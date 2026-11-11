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
  general LLM. A Jev pass is trusted unless the claim carries rules only the
  rubric holds; anything else gets an LLM second opinion.
- **Visibility is derived on read.** The public API shows a fact only when it
  and every node it references are published. The rule is one projection of
  the facts; the public view stores its result per entry so a read does not
  rerun it, and rebuilds it whenever the facts change (see Public view).
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
| `subject_id`    | Entry or sense the fact is about (registry says which; a gap closure's gap decides) |
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
| `sense`         | sense   | one         | `{ gloss, register?, region? }` (region `british`, `american`, `australian`, …) | Jev, then LLM  |
| `form`          | entry   | many        | `{ form, type, pos?, ipa?, accent? }` (plural, past, variant…) | Jev, then LLM; LLM alone for a variant or a form with ipa |
| `relation`      | sense   | many        | `{ type, target_sense_id, domain? }` (`domain` only on a hypernym: `biology` or `medicine`) | Jev, then LLM; LLM alone for an antonym |
| `pronunciation` | entry   | many        | `{ ipa, accent, strength?, pos? }` (accent `us` or `uk`) | LLM            |
| `example`       | sense   | many        | `{ text, translations? }` (`{ zh: "…" }`)                | LLM            |
| `translation`   | sense   | many        | `{ language, text }` (a served language: `zh`)           | LLM            |
| `topic`         | sense   | many (≤ 3)  | `{ topic_id }` (a leaf topic)                            | LLM            |
| `grammar`       | sense   | one         | `{ countability?, number?, article?, transitivity?, position?, agreement?, patterns?, prepositions? }` | Jev, then LLM  |
| `morphology`    | entry   | one         | `{ parts: [{ form, role, meaning?, lemma? }], shortened?: { type, of } }` (`lemma` on a base: the entry it is; `shortened` for an abbreviation, contraction, clipping, or blend) | LLM            |
| `collocation`   | sense   | many (≤ 5)  | `{ text, pattern }`                                      | LLM            |
| `sense_list`    | entry   | one         | `{ common: [sense_id], extra: [sense_id] }`              | LLM            |
| `syllables`     | entry   | one         | `{ syllables: [string] }` (`["a", "bil", "i", "ty"]`)     | LLM            |
| `gap_closure`   | entry or sense, by its gap | many | `{ gap, reason }` (`gap` closable: see Gap closures) | LLM            |

#### Gap closures

The completeness rules ask for what a learner's dictionary *should* have, so
some slots are genuinely empty for some words: a month name has no common
collocations, *beware* has no inflections, a general word (*thing*) belongs to
no topic. A `gap_closure` fact claims exactly that: `{ gap, reason }`, where
`gap` is one of `closableGapSchema` (`forms`, `phrases`, and `family` about the entry;
`category`, `parts`, `synonyms`, `topics`, `grammar`, and `collocations` about a sense), and its
subject is the node that gap is about (`closableGaps` in the registry, read by
`subjectTypeOf`; a closure on the other node is `422 invalid_reference`).
Senses, the sense list, pronunciations, translations, examples, syllables, and
word formation apply to every word and are never closed. The content key is
`gap|textKey(reason)`, so a correction that rewords the reason supersedes the
closure. The LLM alone reviews it: it sees the word (an entry gap, with its
senses) or the sense (a sense gap, with its siblings), the slot, and the
reason, and passes only when a learner's dictionary would genuinely have
nothing for the slot; it fails a closure of a slot that plainly applies (a
common verb's inflections, a word with ordinary synonyms) or a wrong or vague
reason. A `phrases` closure passes only when fewer than three common phrasal
verbs or verb idioms exist and its reason names the ones that do ("throw" has
throw away, throw out, and throw up, so it fails there); a `family` closure only
for a word with no common derivatives ("notebook", or a function word); a
`category` closure for a sense no learner files under a category word (a very
general or abstract sense such as "thing", "idea", or a verb of general action
such as "do"), failing for a kind of thing a learner files under one ("eagle"
is a bird); a `parts` closure for a thing whose main parts a learner's
dictionary does not name (a substance, an abstract or uniform thing) or whose
parts are recorded on the more general whole they belong to ("dog": tail and
paw are parts of "animal"), failing for an object whose parts it names (a
bird's beak, wings, and feathers); a `synonyms` closure for a sense with no
synonym or antonym a learner could use in its place ("eagle", "Tuesday"); a `grammar`
closure passes for a title used before a name ("Mr", "Mrs", "Ms", "Dr"), which
a learner's dictionary prints as used before a name and never marks [C] or
[U], for a pronoun that governs no agreement (an object, reflexive, or
reciprocal pronoun such as "me", "yourself", or "each other" is never the
subject a verb agrees with, and a relative or interrogative pronoun such as
"who" takes the verb its antecedent or answer takes), and for an adverb used
only straight after a number, a clock time, or a measure ("10 a.m.", "aged five
and below"), which has no clause position. Review rejected `agreement` and
`position: end` claims for these and no other property fits them. A fail
reason names the specific value a learner's dictionary gives for the slot.

A closure review also weighs the attempts already rejected for its slot. Each
closable gap names where they are (`closableGaps[gap].attempts`, an
`AttemptSource`): the kinds whose facts about its node fill it (`form`;
`relation` for `category`, `parts`, and `synonyms`; `topic`; `grammar`; `collocation`), the word formations of the
derivatives for `family` (`{ of: "derivatives" }`: the rejected morphology facts
of other entries with a base part naming the node's lemma, which is how a
derivative joins a word family), and none for `phrases`. The review context
carries the latest `ATTEMPTS_WEIGHED` (5) rejected facts from that source, most
recently rejected first, leaving out any whose content a live fact of its kind
about the same subject holds again: each with its payload, the derivative's
lemma for a word formation of another entry (`- morphology of "prayer" {…}`),
the sense at its other end, the topic it names, and the rejection reason. Review
rejected *prayer* (pray + -er) and *restaurateur* (restaurant + -eur) as
borrowed words, so the family closures of *pray* and *restaurant* pass over
them. When the
attempts were rejected as not fitting, the closure passes unless the reviewer
names a specific value that plainly fills the slot and differs from every
rejected one; a value an attempt tried, or an association as loose as theirs,
is no reason to fail. Without this a reviewer that rejects each topic of a
general sense as too general, then the closure because the sense "has a topic
association", stalls the entry for good. A rejected closure holds no content
key (dedupe is against live facts only), so the producer's resubmission after a
rule change is a new fact with a fresh review. A gloss correction that changes a sense's meaning re-reviews the
sense's closures in place. A live closure closes exactly its gap on its node:
the rule's slots count as filled (see Gaps). The public entry shows a
published closure of the entry or of a shown sense only in its review metadata
(`review.closures`: `{ gap, sense_id, reason, fact_id, confidence, verdict }`).

#### Syllables, form pronunciations, and example translations

- **Syllables** divide the written word as a learner's dictionary shows the
  headword (`a·bil·i·ty`): written breaks, not a phonetic transcription.
  Joined, the syllables spell the lemma exactly, and none has a space; a phrase
  has no syllables (its words are their own entries), so a syllables fact about
  a multiword entry, or one that does not spell the lemma, is `422
  invalid_reference`. The content key is the syllables joined with `·`. The LLM
  alone judges the division against the Oxford Advanced Learner's, Cambridge,
  or Merriam-Webster. A single-word entry has a `syllables` gap until it has
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
- **Example translation.** An example may give `translations` by served
  language (`{ "zh": "…" }`; another tag is `400`), judged with the sentence:
  the LLM fails the example when a translation adds, drops, or changes meaning,
  renders the word in another sense, or is not natural text. The translations
  are part of the content key, so adding one is a correction. Every example a
  learner reads needs its translation: a counted sense has one translated-example
  slot per current live example (a live example no live correction supersedes,
  so a pending correction that adds a translation stands for its original), and
  at least as many as the examples it needs (two at A1-A2, else one). Its
  `example_translations` gap names each current live example with no `zh`
  translation (`examples`), which the producer corrects. The public example shows `translation` in the read's
  language (by language tag with `lang=all`, absent without a language).

The migration `public_view_v4_fields` cleared every view for the new document
shape and moved every worklist row's `revision` (not its scored revision), so
`assessEntry` rescores each row with the new gaps: a write that touches the
entry does it at once, and the cron's `refreshStaleWork` drains the rest, 100
a run. Unlike the earlier rescore migrations, it does not recompute the scores
in SQL: the irregular-form rule is TypeScript.

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
not the dominant noun. A spelling variant goes to the LLM alone (see Spelling
variants).

#### Spelling variants

One word has one entry, and the British spelling is the main one: American and
other spellings are `variant` forms on it ("color" on "colour", "yogurt" on
"yoghurt"), never entries of their own. Jev cannot tell which spelling of a
pair is British, so a variant form is judged by the LLM alone, whose rubric
fails a British spelling recorded as a variant of an American one. An entry
whose lemma another live entry records as a live variant form carries those
entries in its review context (`variantOf`) and goes to the LLM alone; the
rubric passes it only when the word has meanings of its own beyond that
spelling ("story" beside "storey", "practice" beside the verb "practise") or
is the British spelling of the pair, and fails it otherwise. As for
inflections (Reviews, Recorded inflections), a variant that publishes marks
for a review in place the entry spelled like it that Jev passed alone. A
variant has no region field: the rule is that a variant on a British entry is
not British.

The migration `variant_spelling_merge` merged the duplicates that existed: for
each (main, variant) pair it lists, whose entries were both live, it retracted
the variant's entry fact (its senses and facts leave the public view), gave the
main entry a pending `variant` form naming the variant unless it held one, and
marked both worklist rows stale. Nothing moved across entries; the producers
refill what the main entry lacks. Homographs and words of their own stayed
entries: a/an, among/amongst, AM and PM/pm, backward/backwards,
forward/forwards, dependent/dependant, practice/practise, licence/license,
program/programme, prise/prize, metre/meter, gram/gramme, kilogram/kilogramme,
dialog/dialogue, and story/storey. Lookups stay exact: `GET /v1/entries/color`
is `404`, while `GET /v1/forms/color` finds "colour" and search ranks an
entry whose variant is the query as its exact lemma.

Relation types are `synonym`, `antonym`, `hypernym`, and `part_of`. The Jev
questions (for every type but `antonym`, which the LLM judges alone) started as the ones the producer qualified. Each now says that two
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
it says about each (see Public API), and gaps count it for both. The migration
`orient_symmetric_relations` flipped stored rows into this orientation and
kept their reviews; a live mirrored pair kept both rows, and the one whose
`subject_id` is larger is the duplicate to retract. A relation is reviewed with
the relation question only. Whether each sense is an established meaning is the
job of that sense's own `sense` fact, and the relation stays hidden until both
are published.

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

- **Floor.** `RELATION_JEV_FLOORS` in the registry is 0.5 for every type Jev
  judges, Jev's fail line: a Jev fail settles a relation, and the LLM decides only
  Jev's uncertain band (see Reviews). An antonym goes to the LLM alone.
- **Gate.** Jev answers only whether the claim holds ("is the first a kind of
  the second"). The layer rules of a hypernym and the most-general-whole rule of
  a `part_of` live in the rubric alone, and after `work_items_relation_layers`
  a confident Jev pass kept dog hypernym canine, cat feline, horse equid, and
  head `part_of` animal. So `RELATION_JEV_SETTLES_PASS` is false for hypernym
  and `part_of`: their Jev request carries `settlesPass: false`, Jev is a gate
  whose fail under the floor still stands, and the LLM decides every other
  answer, so a pass needs both. Sending these types to the LLM alone, as
  antonyms are, would drop the gate the audit found most precise (90.7% for
  Jev alone against 64% for the LLM over an unsure Jev): the LLM alone let
  through head `part_of` princess. A synonym has no rule beyond Jev's question,
  so its Jev pass still settles.
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
- **Re-judging.** The migration `relations_strict_revalidate` marked for
  revalidation every published relation the old rules let through weakly:
  `part_of` to a person-type noun (the target sense has a published hypernym
  chain up to the noun "person" but is not that noun, or its gloss is "A/An
  <head> …" or "A/An <word> <head> …" with a person head), every LLM pass over a
  Jev answer under the floor, and every relation in a structural conflict the
  write rules now refuse. On a copy of the development database it marked 447
  (196 hypernym, 117 `part_of`, 115 synonym, 19 antonym); the reconcile cron
  re-enqueues 500 a run, and each stays public until its new verdict. The
  migration `work_items_relation_layers` marks every published hypernym and
  `part_of` that no curator settled for review in place under the layer and
  whole rubrics (see Work items, Migration).

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
  correction takes its place: a weak topic on a full sense is fixed by a
  correction. A fact has at most one live correction, and a correction goes
  live only while its original is published (invariants I1 and I2 under the
  fact lifecycle), so a correction and its original never both publish.

The content key is the topic id, so resubmitting a tag returns the live fact.
A tag means "a learner meets or needs this sense mainly in this topic", not
"the sense can turn up there", so the LLM alone reviews a topic fact. Jev
passed loose associations: an audit of 100 published topic tags found about 15
loose ones ("full" in hotels, "stop" in driving, "event" in news) while review
had rejected 1.5% of all topic facts. The rubric passes only when the topic is
where a learner characteristically meets or needs the sense: the sense is core
vocabulary of the topic, a word a learner studying the topic should learn,
whether the topic is a scene (at the hospital) or a subject area (emotions,
colours and shapes). It fails a general-purpose sense usable in many scenes
that merely can appear in this one, a loose association, or a topic that fits
a different sense of the word. It lists audited passes ("oven" in household
appliances, "credit" in banking, "angry" in emotions) and fails ("full" in
hotels, "stop" in driving, "event" in news) as examples. A sense may be
core to several topics ("ticket" in trains and in buses); each tag is judged
on its own. The rubric keeps uncertain for a sense or topic it cannot judge at
all and says to fail when it doubts the sense is core; an uncertain verdict
still publishes as weak, as in every chain. It sees the entry's other senses.
Tags published under the earlier Jev-first rubric are judged again: the
migration `topics_strict_revalidate` marks every published topic fact for
revalidation, so the tags stay public while the reconcile cron re-enqueues
them (500 per run) and a fail invalidates a loose one. A topic fact is judged against the gloss, so a gloss
correction that changes its meaning revalidates it like examples,
translations, and relations.

`GET /v1/topics` returns `{ categories: [{ id, name_en, name_zh, topics: [{ id,
name_en, name_zh }] }] }` in display order. `GET /v1/topics/{id}/senses`
returns a keyset page `{ lang, items, next_cursor }` of sense summaries (see
Public API) of the senses that published topic facts tag with that leaf, or
with any leaf of that category, each sense once, in lemma then sense-id order. A sense appears
only while its topic fact, its gloss, and its entry are published. An unknown
id is `404 not_found`, without a fuzzy fallback. The listing reads the public
view's `public_sense_topics` rows, one per topic tag of a public sense, keyed
`(topic_id, lemma, sense_id)`, so a leaf is one index range in page order.
The public entry lists each sense's `topics` as `{ id, name }`, the name in
English and the requested language, and topic facts appear wherever the
management API lists facts.

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
  message names the served languages. A zh text, a translation's or an
  example's, uses fullwidth punctuation: `A zh text uses fullwidth punctuation:
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
  antonym) either end, may not be in the extra senses of its entry's current
  sense list (`Sense … is in the extra senses of its entry's sense list (rare,
  archaic, technical, or specialist); a relation links only common senses.
  Relate a common sense of the word instead.`), except the target of a domain
  hypernym, a specialist term that is often an extra sense of its word
  ("canine" as a zoological family), or have a current gloss labelled
  `dated` (`Sense … is labelled dated; a relation links only current senses.
  Relate a current sense of the word instead.`). The rule reads both ends'
  glosses and sense lists before the write, at submission and when a rejected
  relation is re-reviewed back to life.
- **Sense list.** At least one common sense, and each sense named once, in
  `common` or in `extra`.

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
no plural slot. A title used before a name (*Mr*, *Mrs*, *Dr*) has no
grammar a learner's dictionary prints, so its sense closes the grammar gap with
a gap closure (see Gap closures). The earlier bare
`preposition` pattern claimed only that the word takes some preposition, which
is nearly always true; the migration `grammar_prepositions` retracted every
live grammar fact that used it, so the grammar gap of its sense reopens and the
producer resubmits it with named prepositions, and marked those entries' worklist
rows stale for the rescore cron. It dropped the pattern from every stored
payload, live or not, because reads parse the current shape; a fact's review
still records the claim it judged. On a copy of the development database
(4,049 grammar facts) it retracted 227 published and 2 pending facts, rewrote 28
rejected ones, and marked 149 entries stale, in about 70 ms.
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
review's job. A `base` part may name the entry it is by `lemma`, exactly as the
entry spells it (`student` = `study` (base, lemma `study`) + `-ent`): that link
is what the base's word family reads (see Family). A lemma on any other role is
`400`; a lemma that is not a live entry's is `422 invalid_reference` ("\"glad\"
is not the lemma of a live entry; a base names an entry exactly as it is
spelled. Create that entry first, or leave the lemma out."), checked by the
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
missing sense, duplicate pair, misordered sense, and misplaced sense. The
`sense_list` gap names the senses the list must name, so a rejection leaves it
as the pass's claim found it: the item comes back with one more attempt, its
context (the whole management view) carries every rejected list with its
review reason, and the next pass fixes exactly what the latest names. The third
rejected pass over the same senses hands the item to the curators (see Work
items, Attempts); a sense added or lost changes the gap and starts the attempts
over. A sense another principal authored cannot
be retracted by the producer (retract is author-only), so a duplicate the
reviewer names among such senses goes through feedback or an admin.

The public entry (`GET /v1/entries/{lemma}`) shows its published word formation
as `morphology`, and each public sense (also `GET /v1/senses/{id}`) its
published `grammar` and `collocations`. A kind of cardinality *one* reads
`null` when nothing is published. The entry's senses come in the order of its
published sense list: `common` in order, then `extra` in the order given, then
any sense the list does not name (one added since), and are grouped into one
meaning per part of speech in the order of each one's first sense (see Public
API). An `extra` sense carries `rare: true`; a common one, or one the list does
not name, `false`; without a list the senses keep their creation order. With
`?include=review` the entry's `review.sense_list` is the published list's fact
id, confidence, and verdict, or `null`, so feedback can target it.

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
every label: a sense's register in its `labels`, a form under the meaning of its
part of speech, and a pronunciation's part of speech by listing it under that
meaning instead of the entry. A sense's `register` is part of its content key, so a correction
that only adds or changes a register is a new fact that supersedes the gloss. It
is not part of the sense's identity or its meaning (see Nodes and revalidation).
A form's part of speech is part of its content key too (`type|form|pos`, and
`type|form` unlabelled), so "would" labelled auxiliary is a claim of its own
beside the unlabelled past of "will": relabelling a form is a correction that
supersedes it, which once published takes its place, as a register correction
does a gloss's. The meaning key leaves the label out, as a sense's does. A
labelled form submitted without `supersedes_id` while the unlabelled one is live
adds a second fact, and both show, each under its own meaning; producers
relabel by correction. A pronunciation's labels are not part of its key: the
same transcription with another label returns the live fact, and relabelling
one means retracting it and submitting the labelled fact.

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
rejected facts to pending. A curator's pass moves a pending or published fact
to published and its fail moves one to rejected; see Curation.)
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
(`reconfirm`), and fail moves it to `rejected` (`invalidate`). A kind whose
registry `revalidationFailure` is `flag`, the `sense` kind, stays published on a
fail instead, with the failing review recorded (`flag`: published to published):
rejecting a gloss would hide its sense and every fact judged against it. The
gloss is then a weak fact with reason `failed`, and its producer corrects it; a
correction that only adds the missing label keeps every dependent as it is. A
first review still rejects a failing gloss. If the gloss is
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
  settles only `pass`, and not even that when its request carries
  `settlesPass: false` (hypernym and `part_of`, see Relations), and the LLM
  settles every verdict. A plan asks its
  kind's whole chain, or the LLM alone for a subject Jev misjudges; the LLM
  ends every chain, so a plan may skip the reviewers before it, never it. When Jev fails or is
  unsure about an entry, sense, form, or relation, the LLM judges the same
  claim with a kind-specific rubric and decides: pass or uncertain publishes
  with the LLM's verdict and confidence, fail rejects. The rubric gets the
  lemma, the part of speech, and the entry's other senses; for a relation it
  gets both senses and the target entry's other senses, and also fails a
  relation whose type is not the most accurate one (a mutually substitutable
  pair is a synonym, not a hypernym) or whose target has a better-matching
  sense (see Relations).
  The relation rubric treats glosses as short paraphrases: it judges the
  relation between the words in those senses and does not fail a pair over a
  detail one gloss mentions and the other omits, such as a transitive use or
  an extension in time. `part_of` needs a distinct component or region of
  the whole; a material or ingredient it is made from, or a generic
  part such as a back or side, is not one.
- **Entry admission.** A single-word lemma passes as an established word: a
  dictionary lemma, function word, or established abbreviation, not an
  ordinary inflection, a proper noun that does not count (see Proper nouns),
  misspelling, or invented word. A letter of
  the alphabet is not a word: a lemma of exactly one Unicode letter other than
  the words "a" and "I" is planned as `unreviewable`, so its first review
  rejects it without asking a reviewer. Abbreviations of two or more letters
  are reviewed as before. A
  multiword lemma (one containing whitespace) goes to the LLM alone, with its
  own rubric, and passes only as a lexical unit: its meaning is not the sum of its
  parts (an idiom such as "bear fruit", a compound naming one thing such as
  "red blood cell"), it is an established phrasal verb or verb idiom, one a
  learner's dictionary (Oxford Advanced Learner's, Longman, Cambridge) prints
  as an entry or sub-entry of its verb, even when transparent ("end up", "sit
  down", "come back"), it is a fixed grammatical phrase even when transparent
  ("in front of"), or it is the everyday name of one kind of thing or place
  that speakers learn as a whole ("post office", "bus stop"). A phrase that
  meets none of these fails, such as a descriptive phrase built from the plain
  meanings of its words, even a common one ("wheat grain", "tooth root",
  "white rice"), or a coined category label ("time unit", "plant part"). A
  phrasal verb or verb idiom no learner's dictionary prints fails even when
  another rule seems to hold: a coined or ad-hoc verb and particle, however
  understandable, often a verb made from a noun ("telephone in", "party down",
  "key up", "map onto", "fish about"). Transparent and well-formed is not
  enough; producers filling the phrases gap on nouns used as verbs coined
  exactly those, and the earlier rubric passed them as transparent. The test
  is about the phrase itself and the reviewer's knowledge of those
  dictionaries: reviewers cannot consult them, and no external word list is
  used, because lists such as WordNet include exactly those category labels. Jev does not
  judge phrases: over 1,061 multiword entries it settled 314 passes on its
  own, among them descriptive phrases the rubric fails ("spatial
  distribution", "mountain system", "scientific law").
- **Proper nouns.** A learner's dictionary prints the proper nouns learners
  meet as vocabulary, and the entry and sense reviews admit those and no
  others. One rule (`PROPER_NOUNS` in `server/domain/fact-kinds.ts`) is stated
  verbatim in the entry Jev question, every entry rubric (single word, phrase,
  CEFR headword), the sense Jev question, and the sense rubric: an established
  proper noun that learner's dictionaries such as Oxford, Cambridge, and
  Longman include in their main text or their appendix of geographical names
  counts (a country, continent, nationality or demonym, language, people,
  religion, adherent of a religion, scripture, festival or holiday, day or
  month, major world city or capital such as "London", "Paris", "Beijing", or
  "New York", or well-known geographical feature such as "the Thames", "the
  Alps", or "the Pacific"); a proper noun they leave out does not (a personal
  name such as "John", "David", or "Trump" as a person, a brand or company
  name such as "Facebook" or "Google", an organisation, or a minor place such
  as a small town, a street, or a local area). A phrase that counts passes as a
  lexical unit ("New York", "Good Friday"). The sense rubric also fails a
  proper noun glossed under a spelling with other capitalization: the ocean is
  a sense of "Pacific", not of "pacific". Invented words, misspellings, and
  plain inflections fail as before. The earlier rubrics failed every proper
  name, which rejected "London" and the Christian holy days.
  The migration `proper_noun_rereview` re-judges them: an entry or sense
  fact that is the latest rejection of its slot, whose stored review reason
  mentions a proper name, proper noun, or the name of a place or person
  (matched case-insensitively), returns to `pending` through the `rereview`
  transition, unless a curator settled it, it is a correction, or the slot
  holds a live fact (the slot is exclusive, so one fact per slot revives). Its
  `updated_at` predates the reconcile cutoff so the next run enqueues it; the
  old review stays until the new one replaces it. The rows of the owning
  entries are bumped, and an entry whose entry fact revives is live again. On
  a copy of the development database (16,501 entries) it revived 28 entry
  facts (among them London, Good Friday, Ash Wednesday, American Sign
  Language, Ursa Major, Labour Party, Luna, Hershey's Kiss) and 1 sense fact
  ("pacific" glossed as the ocean), made 29 rows stale, and a second run
  changed nothing.
- **CEFR evidence.** The CEFR learner vocabulary lists (see Reference data)
  are an authority that a headword is vocabulary learners need; the lexical-unit
  test rejected about half of the multiword entries the lists name ("mental
  health", "weather forecast", "get changed"). When `lemma_cefr` lists the exact
  lemma, the entry review carries the listings in its context (`cefr`: each
  level, part of speech, and source name, read in one indexed lookup) and the
  LLM rubric replaces the admission criteria with that evidence: the headword
  passes unless it is nothing but an inflected form of another word (a
  headword with uses of its own, such as "could" or "best", passes), a proper
  noun that does not count, or a misspelling, and a phrase is not asked whether it is a lexical unit. The plan
  is unchanged: a phrase goes to the LLM alone, a single word to Jev and then
  the LLM unless an inflection is recorded, and a listed single word's LLM
  rubric carries the evidence when it is asked. A lemma no list names (an
  agent-created neighbor) keeps the criteria above.
- **Recorded inflections.** Jev also passed bare inflections as words ("is"
  at 0.99, "was", "has", "did"). When another entry whose entry fact is live
  holds a live inflection (a form of any type but `variant`) spelled like the lemma, the
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
  type (a variant too, with the variant evidence of Spelling variants), the other entry spelled like the form whose published
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
- **Antonyms** go to the LLM alone: Jev passed converse role pairs as
  opposites (teacher and student), and the rubric says a converse role pair,
  where each role implies the other (teacher and student, interviewer and
  interviewee, buyer and seller, parent and child), is not an antonym. Every
  relation rubric also fails a target that is archaic or old-fashioned in its
  sense: a target labelled `dated` is refused at write (Relation ends), so a
  target that reaches review claims to be current English.
- **Relation floor.** A relation request Jev judges (synonym, hypernym,
  part_of) carries `settlesFailBelow` from
  `RELATION_JEV_FLOORS`, 0.5 for each of those types: a Jev answer under it settles the
  fail without asking the LLM. It started at 0.15, when every relation the LLM
  had published under that line was wrong (shore `part_of` key at 0.09); the
  relation audit (see Relations) found the LLM's passes under 0.5 mostly wrong
  for every type, about half right even for synonyms, so the floor now meets
  Jev's fail line. Other kinds have no floor: the LLM correctly published the
  plural "stone" over a Jev answer of 0.07.
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
- **Grammar** asks Jev one yes/no question per property, per pattern, and per
  named preposition, each
  about the sense only ("Consider the English verb "run" only in the sense …,
  not in any other sense. Is it intransitive: it never takes a direct object?").
  The questions are keyed `countability`, `transitivity`, `position`, and
  `pattern_<name>`, and `preposition_<name>` (spaces as underscores), and each
  pattern names an illustration ("decide to leave" for a verb, "happy to help"
  for an adjective); a preposition asks "Is it commonly followed by the
  preposition "on"?". The LLM second opinion lists
  every claim, as the Oxford Advanced Learner's, Longman, or Cambridge would
  mark the sense: it passes when each claim holds for this sense, fails a claim
  that is wrong or holds only for another sense, a pattern that is rare or
  unnatural with it, or a named preposition that is not the one learners use
  with this sense or is rare with it, and does not fail a pattern or
  preposition left out. It says a plural-only noun is marked [plural] in place
  of countable or uncountable, so a missing countability is not an omission, and
  the `number` claim of `plural_only` reads "used only in the plural, with a
  plural verb and never with "a" or "an" … as a learner's dictionary marks
  [plural]".
- **Word formation** goes to the LLM alone: Jev passed etymological splits of
  opaque words (fact + -ory) and failed simple claims of loans for their Latin
  roots. The rubric asks for the formation a learner's dictionary gives by one
  synchronic rule, so a word cannot fail both as simple and as analysed (review
  had failed *important*, *factory*, and *delicious* as simple words for their
  Latin roots and their root splits as etymology): a word has parts only when a
  present-day speaker sees in it a present-day English word with affixes or
  another word, and its meaning comes from that word; every other word is a
  simple word, one base, even with a Latin or Greek root or letters that look
  like an affix ("important" is one base, not im- + port + -ant; "factory";
  "window"; "business" (trade) is not busy + -ness). A simple claim for such a
  word passes and is never failed for its etymology; a root part is etymology
  and fails; a transparent derivative claimed simple ("teacher", "happiness")
  fails. A one-part base naming another lemma is claimed as "made from the word
  "shelf" without a prefix or suffix, as a conversion with a spelling change or
  a back-formation", which passes when that word is the one the meaning comes
  from (review had failed *shelve* naming *shelf*, because the claim read
  "a simple word", and *televise* split as telev + -ise for being a
  back-formation). A shortened word is one base with its source: the
  rubric claims "a shortened word, an abbreviation of "mistress"", passes a right
  source of a type a dictionary gives it (dictionaries call some contractions,
  such as "Mrs", abbreviations), and fails a wrong source or type and a
  shortened word claimed as a plain simple word. It allows spelling changes where parts join and fails a
  wrong, missing, or extra part, a wrong meaning, etymology rather than
  present-day formation, folk etymology, letters that only look like an affix
  (the "er" of "water"), and a word claimed simple that has parts. A base is the
  present-day word the meaning comes from, even when its spelling changes where
  the parts join: "student" is study + -ent (a student studies), not stud +
  -ent, and the rubric fails a base that only shares letters with the word or a
  named lemma that is not the word the meaning comes from. The audit found
  *student* analysed as stud + -ent; `completeness_usage_family` marks every
  published formation of more than one part for review in place.
- **Senses** state their region and register. `region` names the one variety
  of English that uses a sense: `british`, `american`, `australian`,
  `new_zealand`, `canadian`, `irish`, `scottish`, `south_african`, or `indian`
  (the audit's *stay* meaning to live somewhere is Scottish; a closed list, so
  another variety's sense goes in the sense list's extra). Jev is asked about
  the region stated, and, with none, told that a sense used only in one variety
  answers no; with no register, it is told that a sense used only in a formal,
  literary, dated (old-fashioned), or ironic register answers no, so its LLM
  second opinion judges it. `ironic` joined the registers for senses such as
  "fine" in "a fine friend you are". The rubric fails a one-variety sense without
  its region ("lorry", "flat" an apartment, and "mobile" a mobile phone british;
  "sidewalk" american), a region that does not fit, a formal, literary, dated,
  or ironic sense without its register, and a sense learner's dictionaries label
  old-fashioned that is not labelled `dated`, which is how this dictionary
  writes that label (there is no separate old-fashioned register). A region is
  a label like the register: it is part of the content key, not of the meaning
  key, so a region-only correction supersedes the gloss without re-reviewing
  its dependents. Creating a sense matches an existing one by the gloss's
  meaning key (its content key or the key with labels after `|`, one index
  range), so the same gloss with any labels returns the existing sense.
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
  cover every sense a learner's dictionary (Oxford Advanced Learner's, Longman,
  Cambridge) lists among its main senses of the word for A1 to B1 learners, in
  every part of speech, so a missing main sense fails and a sense only an
  advanced or specialist dictionary lists does not; no two common senses are
  duplicates or one meaning split too finely; the common senses run in a
  plausible order from more to less common for a learner, judged sense by sense
  across every part of speech, never one part of speech before another, with
  the sense a learner most needs first ("mobile" starts with the noun meaning a
  mobile phone, before any adjective sense; the audit's list put an adjective
  first, and the public view orders meanings by their first common sense, so
  the noun showed after the adjective's seven), frequency order being
  approximate, so the reviewer judges plausibility and never answers uncertain
  because exact frequency order cannot be verified; and specialist, technical,
  legal, archaic, and rare senses, and senses of a variety other than British or
  American English, belong in extra ("stay" meaning to stop legal proceedings),
  every extra sense being one a learner does not meet in general use. A rare, archaic, Old English, technical, or specialist sense
  missing from both lists is never a failure. Uncertain is only for a word the
  reviewer cannot judge at all: 178 sense lists had published on an uncertain
  verdict, mostly over unverifiable order, and `completeness_rules` marked them
  for review in place. Entries are case-sensitive, so
  the rubric judges only the exact spelling: a sense that belongs to a spelling
  differing in capitalization, or to a proper name spelled otherwise, belongs
  to that other entry and is never missing ("May" the month is not missing
  from "may", nor "Polish" from "polish"); reviewing "May" itself, the month
  is its own common sense. When other entries whose entry fact is live are spelled like the
  lemma but for letter case, the review context carries their lemmas
  (`caseVariants`) and the rubric names each as a separate entry whose senses
  are not this word's. They are read in one lookup on `entries_lemma_case_idx`,
  an index on `lower(lemma)` (SQLite folds ASCII letters only). This is not a
  fallback: the lookup of the entry under review stays exact, and the variants
  are other entries named to the reviewer as what this entry is not, never
  substituted for it. The reason of a fail names
  everything to change, even past one sentence: each missing common sense with
  its part of speech and a short meaning, each pair of duplicates by number,
  each sense out of order, each specialist sense in common, and each common sense put in extra, so the producer
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
`429 rate_limited` with `Retry-After: 60`. Feedback moves through `open → claimed → resolved | dismissed`.
An agent claims a feedback item with a one-hour lease, so two agents do not
work the same report. An expired claim can be claimed again by anyone, and the
holder can renew its claim at any time. Only the holder resolves (linking the
correcting fact IDs) or dismisses (with a note). Every feedback write is a
compare-and-set on a revision counter.

## Curation

The review rules only need to pass the great majority of facts. The words they
handle badly (titles like *Mrs*, contractions like *o'clock*, plural-only nouns
like *jeans*, conversions like *shelve*) are curated by hand instead of tuned
for one by one. A **curator** is an admin, or an agent an admin issued with the
curator capability: `POST /manage/v1/agents` with `{ "name": "…", "curator":
true }` stores `curator = 1` on the agent row and the principal carries it.
Producer agents are issued without it and get `403 forbidden` on every curator
operation.

A curator's verdict replaces the reviewer chain's. It is recorded as the fact's
review with `reviewer: "curator"`, `model` the curator's principal ref
(`agent:…` or `admin:…`), the verdict, confidence 1, the curator's reason,
empty `context` and `detail`, and `reviewed_at`. A fact whose review names the
curator is **curated**.

- **Curated write.** `POST /manage/v1/facts` with `curation: { reason }` runs
  every submission rule (payload schema, subject and target checks, the kind's
  write rules, content-key dedupe, slots, and `supersedes_id`), inserts the fact
  pending, and then writes the curator's pass through the `curate_pass`
  transition instead of enqueueing a review. A curated correction retires the
  fact it supersedes and marks the facts judged against it exactly as a passing
  review would. A submission whose content a live fact holds returns that fact
  unchanged with `200`. If the second write is lost, the reconcile cron sends
  the pending fact through the reviewer chain, so the write still converges.
- **Settle.** `POST /manage/v1/facts/{id}/curate` with `{ verdict, reason }`.
  `pass` publishes a pending or published fact (`curate_pass`), which replaces
  an uncertain or failing standing review, so the fact is no longer weak, and
  clears any revalidation mark. `fail` rejects a pending or published fact
  (`curate_fail`). Passing a rejected fact first revives it through the
  `rereview` reset, so it is `409 conflict` exactly when re-reviewing it would
  be: another live fact holds its content or exclusive slot, a live correction
  supersedes it, or the original it corrects is no longer published. Any other
  status is `409 conflict`.
- **Final for the rules.** No revalidation mark is ever written on a curated
  fact: the gloss-correction mark carries `review.reviewer <> 'curator'`, and
  the evidence mark matches only facts its reviewer chain settled. A migration
  that re-judges facts after a rule change (marks `revalidate_since`, retracts,
  or resets them) must add `AND coalesce(json_extract(review, '$.reviewer'),
  '') <> 'curator'` to its `WHERE`. Only a curator may supersede or retract a
  curated fact, or resubmit content a curator rejected; anyone else gets `403
  curated_fact`.
- **Weak facts to review.** `GET /manage/v1/facts?weak=true` lists the
  published facts whose standing review is `uncertain` or `fail`, newest first
  with the usual cursor pages, narrowed by `kind` and by `level` (A1 to C2: the
  lowest CEFR level of the lemma of the entry the fact is about, or whose sense
  it is about, as the worklist's `level_rank` stores it).

- **Items to fill.** `GET /manage/v1/work/curation` lists the work items three
  producer passes left unchanged (see Work items, Curators' queue); a curated
  write that fills or closes one closes the item.

A curated write or settle bumps the entry's worklist revision and rescores it
like any fact write, and a curated fact counts as a published one. The audit
boundary logs each of these `POST`s with the curator as the actor. The public
API is unchanged: its review metadata names no reviewer.

## Work items

Agents ask the server what to work on instead of keeping their own list. The
unit of work is a **work item**: one open gap of an entry or of one of its
senses (see Gaps), or one weak fact. Facts are the unit of review, and items are
the unit of work, so cheap, valuable work never waits behind the rest of its
entry: "eagle is a kind of bird" is a category item of its own, claimed long
before eagle's examples, and like decisions come together because a claim
leases items of one type at a time. Each item is leased, worked, and judged on
its own; a lease keeps two agents off the same item. The entry keeps a
completeness and a quality score for stats and the console, derived as before.

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
        "related": [{ "sense_id": "…", "lemma": "bird", "pos": "noun", "gloss": "…" }],
        "view": null
      }
    }
  ]
}
```

`subject_id` is the node the item is about: the entry, a sense, or the weak
fact. The context is what a worker needs without another read (`workContext`
in `server/domain/work-context.ts`): the entry with its level, frequency, and
senses (current glosses, common senses first in the current list's order, each
marked rare when the list puts it in extra), the sense the item is about (null
for an entry item), every fact about the item's node in every status with its
review (a sense's facts and the relations pointing at it, an entry's own facts,
or for a weak fact the node it is about), the senses at the other end of those
relations, and, for the types that read every sense at once (`senses`,
`sense_list`, `phrases`, `family`), the entry's whole management view as `GET
/manage/v1/entries/{lemma}` returns it. A rejected fact in the context carries
its review reason, so a retry reads why the last attempt failed.

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

`POST /manage/v1/work/{lease_id}/complete` with `{ items: [{ id, note? }] }`
(notes up to 500 characters) ends the pass. The items named were worked; the
lease's other items are released without an attempt. Only the holder completes,
and only before `expires_at`: another principal or an expired lease is `409
conflict`, a lease that is gone `404 not_found` (so a second complete is 404),
and an item the lease did not claim `422 invalid_reference`. In one batch, while
the lease is still held, it marks the named items worked with the note and the
holder, releases every item of the lease, bumps the revision of the lease's
entries and stamps their `last_worked_at`, and deletes the lease; then it
rescores those entries and answers where each named item stands:

```json
{ "lease_id": "…", "items": [{ "id": "…", "state": "awaiting_review", "attempts": 0 }] }
```

`closed`: the gap is gone (the pass filled it with published facts, or a
closure). `open`: back in the production queue. `awaiting_review`: a pending
fact may change it, so its verdict waits for that review (see Attempts).
`curation`: three passes left it unchanged. An expired lease is kept a day
(`EXPIRED_LEASE_RETENTION_MS`), so a holder that completes late learns that it
expired; the cron then deletes it (`purgeExpiredLeases`).

### Curators' queue

`GET /manage/v1/work/curation?type=&limit=&cursor=` (curators and admins; a
producer agent gets `403 forbidden`) pages the items three completed passes
left as their claims found them, in queue order, each with its gap, attempts,
lemma, and the last pass's `last_worked_at`, `last_worked_by`, and `last_note`.
They are out of the production queue: the producers cannot fill them. A curator
fills or settles them with curated facts (see Curation); a curated write
rescores the entry like any other, and any change to an item's gap (a new fact
from anyone, a fact leaving live) starts its attempts over and puts it back in
the production queue.

### Priority

`WORK_POLICY` in `server/domain/work.ts` is the one table of what each type of
work is worth and what context it needs; nothing else branches on a type.
`workPriority` ranks an item by its type's **stage**, then the **learner band**
of its entry, then its entry's Zipf frequency, highest first (`zipf_order`, -1
without one), then age and id:

| Stage | Types | Why |
| ----- | ----- | --- |
| 1 identity | `senses`, `sense_list` | Nothing else can be judged before the senses exist and are settled |
| 2 meaning | `translations`, `category`, `parts` | What the word means to a learner, and where it sits in the everyday taxonomy |
| 3 usage | `examples`, `example_translations`, `grammar`, `collocations`, `forms`, `pronunciation`, `syllables`, `morphology`, `form_pronunciations` | How the word is used |
| 4 network | `synonyms`, `family`, `phrases`, `topics` | What the word connects to |
| 5 weak facts | `weak_fact` | Replacing what is there comes after filling what is not |

The band is the entry's lowest CEFR level, A1 to C2 (0 to 5), then a frequency
without a level (6), then neither (7) (`learnerBand`). `rank` is the stage
times the eight bands plus the band, so the stage dominates: every CEFR noun's
category is claimed before any B1 example, and a C2 word's senses before any A1
category. The CEFR headwords the core import creates (see Core entries) are live
entries with no senses until a producer works them, so their `senses` items are
stage 1 in every band and come before every category, whose items follow them.
The table is a starting policy, tuned by editing it; a release that changes it
ships with a migration that bumps every worklist row so the rescore re-ranks
the items. An import re-ranks the items with the worklist (`rankWorkItemsSql`).
A claim does not group items of one topic or category neighbourhood beyond
their type and rank.

### Attempts and awaiting review

A rescore computes the entry's open work twice: over its live facts and over
its published facts alone (`assessEntry`). A piece of work the two disagree on
**awaits review**: a pending fact may fill it, change it, or close it, so it is
not served (`awaiting`), while the entry's other items stay workable. A pending
pronunciation holds only the pronunciation item; a pending entry fact holds every
item of its entry. A weak fact a pending correction supersedes awaits that
correction. An entry whose entry fact is not live has no open work.

An item counts **attempts**, the completed passes that left its gap as their
claim found it (`reconcileItems`). Completing a lease marks the named items
`worked`; the rescore that follows judges each once it no longer awaits review:
if its gap is what the claim recorded (`claimed_gap`), the pass made no lasting
progress and the item gains an attempt; any other gap starts the attempts over.
So a pass that added nothing counts at once, a pass whose facts review rejects
counts when the rejection lands (the item awaited the verdict, so no other pass
changed it meanwhile), and a pass whose facts publish moves the item on or
closes it. A change by anyone to an item nobody worked also starts it over: a
new sense, another principal's fact, a fact leaving live. At
`MAX_ATTEMPTS` (3) the item leaves the production queue for the curators. Gaps
compare by what they say (`gapText`, keys sorted), and the `sense_list` gap
names the senses its list must name rather than counting rejections, so each
rejected list is an attempt of the same item and the third hands it to the
curators (see Sense lists).

### Scores

Both scores are pure functions of the entry's facts in `server/domain/work.ts`
(`assessEntry`), computed on read for the views and stored on the worklist for
stats and the console. The work itself is the items.

**Completeness** (0..1) is filled slots over the slots the gap rules count.
"Complete" means every piece of data a learner's dictionary should have for the
word exists, not that every field has a value. The entry has the sense
inventory slot and two pronunciation slots (a strong `us` and a strong `uk`
pronunciation); a single word adds one slot per inflection its paradigm needs
(see Forms), word formation, and syllables; an A1 or A2 single-word verb one
for a phrase built on it; and one per live irregular form (its
pronunciation). Each counted sense adds the relation slots (see Relation
slots), topics, grammar, and collocations its part of speech needs, its examples (two for an A1 or A2
entry, else one), one `zh` translation, and one example with a `zh`
translation. A live gap closure fills every slot of the gap it closes (see Gap
closures). A counted sense is one whose gloss is live and
that the entry's current sense list does not put in `extra`; before a list
exists, every sense with a live gloss counts. A relation counts, at either end, only
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
targets it, when it is published on an `uncertain` review verdict, or when it
stays published on a `fail` verdict (a gloss its review in place failed; see
Fact lifecycle). Each is a `weak_fact` item, `{ type: "weak_fact", fact_id,
kind, reason }` with reason `feedback`, `uncertain`, or `failed`, so a producer
reads the review reason and submits a correction that supersedes it or retracts
it. A weak fact a live correction supersedes is being replaced, so it is not
counted weak and its item awaits that correction's review. Feedback on an
entry or sense, not a fact, makes nothing weak: it is worked through the
feedback API. Quality is 1 exactly when no fact is weak.

### Relation slots

Relations have no quotas. The earlier rule asked two relations of every noun,
verb, and adjective sense, so a sense was padded with whatever relation came to
hand ("bird" listed only turkey as a kind; "animal" listed he, girl, head, and
baby). Three slots replace it, each one fact deep and each closable:

| Slot | Senses | Filled by |
| ---- | ------ | --------- |
| `category` | Counted noun senses (`CATEGORY_POS`); learner's dictionaries file nouns, not verbs, so no verb sense is asked for a broader verb | A live everyday hypernym (no `domain`) from the sense to a sense that can show; a word may have several (dog: animal, pet), and one fills the slot |
| `parts` | Counted noun senses with an everyday category (`PARTS_POS`) | A live `part_of` from a sense that can show to this one (bird: beak, wing, feather) |
| `synonyms` | Counted noun, verb, adjective, and adverb senses (`SYNONYMS_POS`) | A live synonym or antonym at either end, to a sense that can show |

A domain hypernym fills no slot: the specialist layer is never required. A
sense's own `part_of` fills nothing here; it is the whole's parts slot. A sense
whose category is closed as general or abstract has no parts slot, so only
things a learner files under a category are asked for parts; a thing whose
parts are recorded on its more general whole closes it ("dog": tail and paw are
parts of "animal"). The slots ask for the relations a learner's dictionary
gives, all of them in one pass, not for a count; the gap descriptions say so.
Narrower terms and parts are never asked of the category or whole: "animal"
gets its members from every animal's category item, which is why every CEFR
noun's category is stage 2. A pronoun or another function word has no relation
slot: a personal or relative pronoun's sense has no synonym or antonym in a
learner's dictionary, and its closures kept failing over loose candidates ("I"
for the royal *we*). A pronoun may still carry relations (*everything*:
nothing).

`TOPICS_NEEDED` is the table of the topics a sense needs: noun and verb 1;
every other part of speech 0, which means no topics gap and no topic slot.
Nouns and verbs name the things and actions a scene is made of. An adjective or
adverb may carry topics but needs none: most adjectives are general (*big*,
*good*). General-vocabulary noun and verb senses (*get*, *make*, *thing*)
belong to no topic: a reviewed gap closure closes their topics gap.

### Number senses

`number` is the part of speech learner's dictionaries print for a number word:
OALD and Cambridge label *two*, *hundred*, and *million* "number" and *first*
and *second* "ordinal number". One `number` covers cardinals and ordinals; the
gloss tells them apart, so no second part of speech is needed. A number sense
needs what every sense needs (examples, two at A1 or A2, a Chinese translation,
and translated examples) and nothing else: no category (a learner does not
file *two* under a broader word, as no other function word is), no parts, no
synonym slot, no topics (a number belongs to every scene), no grammar (a
learner's dictionary prints none, and the grammar registry refuses it), and no
collocations (*two cats* combines freely). It has no paradigm either: the plural
in *hundreds of people* or *in their thousands* is a noun use, recorded as a
noun sense with its plural when a curator adds one. Other uses of an ordinal
keep their own part of speech (*first* in "arrive first" is an adverb). The sense
rubric tells the reviewer that general dictionaries file the same meaning as a
noun, adjective, determiner, or pronoun, which does not fail it, and Jev's
question names it a "number (numeral)" sense. No migration was needed: `pos` is
a TEXT column, and no stored sense had the value.

### Grammar, collocations, and word formation

`GRAMMAR_NEEDED` and `COLLOCATIONS_NEEDED` in `server/domain/work.ts` are the
tables of what a sense needs, like `TOPICS_NEEDED`. Noun, verb, adjective,
adverb, determiner, and pronoun senses need one grammar fact: countability,
transitivity, position, patterns, or prepositions are what a learner most needs
of a content word (an adjective with no restriction states `position: both`),
the usual position of an adverb (*usually* mid, *just* mid, *fine* end), and
what a determiner or pronoun agrees with (*each* + a singular noun, *much* + an
uncountable noun, *each of* + a plural, *everybody* + a singular verb).
Noun, verb, adjective, adverb, determiner, preposition, and conjunction senses
need one collocation: function words are learnt in set combinations (*hardly
any*, *any more*, *filled with*, *angry with*, *both … and*, *and so on*), and
every adverb, not only a manner adverb, has its common ones (*just a minute*,
*only just*, *work fine*). A pronoun, number, interjection, or auxiliary needs none.
The audit of 40 A1 entries scored the function words and adverbs 1.00 under the
earlier tables while a learner's dictionary gave them 0.69 to 0.93. Each gap is
closable, so a sense with genuinely nothing there (*any* as an adverb before a
comparative has no collocation beyond its pattern) closes it. A single-word
entry needs one word formation; a phrase none, since its words are their own
entries.

#### Forms

The forms gap names the inflections a learner's dictionary gives for the
word's parts of speech (`formSlots`), each as `{ type, pos }`, for a single
word's counted senses:

| Part of speech | Slots                                                              |
| -------------- | ------------------------------------------------------------------ |
| verb           | `third_person_singular`, `past`, `past_participle`, `present_participle` |
| noun           | `plural`, when a counted noun sense's live grammar is `countable` or `both` |
| adjective      | `comparative`, `superlative`, when it compares with -er and -est: its live syllables fact has one syllable, or two and the lemma ends in y, or an inflected comparison of the adjective is recorded |
| adverb         | `comparative`, `superlative`, when an inflected comparison of the adverb is recorded |

A live form fills a slot of its type when it is labelled with the slot's part
of speech, or unlabelled and shown under it (`formMeaning`, the carrier order
the public view uses). A periphrastic comparison fills nothing, and is refused
at write. A phrase inflects in its words' entries, so it has no forms gap;
neither does an invariable word (*ago*, *ours*), an uncountable noun, a word
whose comparisons are periphrastic, or a number. A defective word (*beware*) closes
its forms gap with a gap closure. The test for comparison reads the syllables
fact, so a short adjective's comparison slots open once its syllables are
recorded, which changes its open work.

#### Phrases

A core verb, a single-word entry with a counted verb sense whose exact lemma
`lemma_cefr` lists with pos `verb` at A1 or A2, needs `PHRASES_NEEDED` (3) live
phrasal verbs or verb idioms headed by it: multiword entries whose first word
is the lemma, case-sensitively, with a live verb sense (*give up*, *give in*,
*give way*). Learners meet core verbs in them, and a learner's dictionary
lists several for most common verbs. An A1 or A2 word listed only as another
part of speech has no phrases gap even with a verb sense: nouns used as verbs
(*telephone*, *party*, *key*, *map*, *fish*) head few learner phrasal verbs,
and asking them for three had producers coin "telephone in" and "party down".
The snapshot reads `coreVerb` with the worklist row, as one primary-key lookup
of `lemma_cefr` (`lemma`, `pos`). A phrase that only contains the
word (*ordinary share*, *hip throw*, *hired help* closed the earlier
one-phrase rule) or is not a verb (*help desk*, *stay of execution*) does not
count. Each missing phrase is a slot. The snapshot reads the phrases by one
range scan on the lemma index (`lemma > 'give '` and `< 'give!'`, the
character after the space). The gap is `{ type: "phrases", have, need }`,
naming the ones that count. The producer fills it by creating each phrase as
its own entry (`POST /manage/v1/entries`), then its verb sense with its gloss
and the facts a phrase needs; the head's gap updates as soon as the phrase's
entry fact and verb sense are live, because an entry or sense fact's write marks
the head of its phrase stale and its refresh rescores it
(`touchLinkedWorkOfFact`, `relatedWorklistRows`, and the sense insert's batch).
A verb with fewer than three common phrasal verbs creates the ones that exist
and closes the gap with a closure whose reason names them; review fails it
when a common one is missing. The audit measured 43% of the phrasal verbs a
learner's dictionary gives on A1 verbs under the one-phrase rule.

#### Family

An A1 or A2 single-word entry needs a word family: one live entry whose live
morphology names it as a base by `lemma` (*happiness*, *happily*, and *unhappy*
for *happy*; *student* for *study*). The audit found 6% of the derivatives a
learner's dictionary lists. The snapshot reads the other live entries with a
live morphology fact one of whose base parts has this lemma (`json_each` over
the parts, prefiltered by the quoted lemma in the payload text), and the gap is
`{ type: "family" }` until one exists; a phrase or a higher level has none. The
producer fills it by finding the common derivatives, creating each derivative's
entry if it is missing, and submitting (or correcting) its morphology with the
base part naming this word as `lemma`. A morphology fact entering or leaving
live, or a derivative's entry fact doing so, marks the bases it names stale, and
the write's refresh rescores them in the same request. A word with no common
derivatives (*notebook*, a function word) closes the gap with a closure. The
public entry reads a base by the lemma it names (`partWord`), so the words built
on one entry list each other, and the base itself, in their `family`.

### The worklist and work item tables

`worklist` holds one row per entry, written in the same batch as the entry:

| Column                                            | Meaning                                                    |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `entry_id`, `created_at`                          | The entry and its creation time                            |
| `live`                                            | The entry fact is pending or published                     |
| `seed`                                            | The entry was submitted as part of a seed list             |
| `frequency_key`                                   | `frequencyKey` of the lemma, written with the row          |
| `level_rank`, `zipf`                              | The learner priority: 1 (A1) to 6 (C2) for the lowest CEFR level of the exact lemma, and the Zipf frequency of `frequency_key`; null when the reference data has none |
| `completeness`, `quality`                         | The scores, as of `scored_revision`                        |
| `revision`, `scored_revision`                     | Bumped by every write that can change the entry's work or public view; the revision the scores and items describe |
| `view_revision`                                   | The revision the entry's public view rows describe         |
| `last_worked_at`                                  | When a pass over one of its items last completed           |

`work_items` holds one row per piece of open work:

| Column | Meaning |
| ------ | ------- |
| `id` | The item; kept while its gap stays open, however it changes |
| `entry_id`, `type`, `subject_id` | The entry, the work type, and the node it is about (entry, sense, or weak fact); `(type, subject_id)` is unique |
| `gap` | The gap as the wire shows it, JSON |
| `stage`, `rank`, `zipf_order` | The policy stage, the stage times eight plus the learner band, and the entry's Zipf frequency (-1 without one) |
| `awaiting` | A pending fact changes the gap, so it is not served |
| `attempts`, `worked`, `claimed_gap` | Completed passes that left it unchanged; a completed pass whose verdict waits for a review; the gap at the last claim |
| `lease_id`, `lease_holder`, `lease_expires_at` | The current or last lease; all set or all null |
| `last_worked_at`, `last_worked_by`, `last_note` | The last completed pass over it |
| `created_at` | When the item opened |

The production queue is the items with `awaiting = 0 and attempts < 3`, in the
partial indexes `work_items_queue_idx` `(rank, zipf_order DESC, created_at, id)`
and `work_items_type_queue_idx` (the same, led by `type`); the curators' queue
is `work_items_curation_idx` over `attempts >= 3`. `work_leases` holds one row
per lease (`id`, `holder`, `type`, `entry_ids`, `item_ids`, `claimed_at`,
`expires_at`), deleted by its completion or a day after it expires.

Every write that can change an entry's gaps, weak facts, or public view bumps
`revision` of the entries at both ends in its own batch: a fact insert or status
change (review, retraction, re-review, supersede), a sense insert, a feedback
insert or status change on a fact, and a completion. Every insert or status
change of an `entry` or `sense` fact also bumps the entries whose relations
link to the senses that fact defines: moving into or out of live changes their
relation slots, and moving into or out of published, or a gloss correction
publishing, changes the relations their public views show. A reference import
bumps every row (see Public view). The use case that made the write then
rescores the stale rows it touched, linked entries included, and rebuilds their
public views (`refreshEntries`, which runs `refreshWork` and
`refreshPublicViews`). The rescore loads the entry and its stored items,
assesses it, reconciles the items with its open work (`reconcileItems`), and
writes the scores, the upserted items (by `(type, subject_id)`, keeping each
stored item's id, lease, and claim and work records; a new item gets a fresh
id), and the deletion of closed ones in one batch, each statement conditional on
`revision` being unchanged, so a concurrent write's rescore wins instead of
being overwritten. A stale row keeps its items as of its last rescore until a
rescore reaches it, and the cron rescores up to 100 stale rows every run
(`refreshStaleWork`). It tries every row of the batch before it throws the
failures together, so a row that keeps failing holds one slot and the rows
behind it still drain. Every fact insert or status change also rewrites `live`
for its subject.

**Rescore.** Scores never go stale silently: whenever the gap rules change,
the release's migration bumps `revision` on every row, so every stored score
and item is stale until `assessEntry` scores it again under the new rules. The
management view (`GET /manage/v1/entries/{lemma}` and a claimed item's `view`)
computes `completeness` and `quality` from the facts on read, so it never
reports a stored number at all, and no public document carries one.
The cron's 100 rows every five minutes would take hours over the dataset, so
`POST /manage/v1/work/rescore` (admins only, body `{ limit }`, 1 to 200,
default 100) rescores up to `limit` stale rows as the cron does and returns
`{ rescored, remaining }`; repeat it until `remaining` is 0 right after
`wrangler d1 migrations apply`, then drain the public views the same way with
`POST /manage/v1/public/rebuild`:

```sh
until [ "$(curl -sf -X POST "$BASE/manage/v1/work/rescore" \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"limit":200}' | jq .remaining)" = 0 ]; do :; done
```

On a copy of the development database (13,323 entries, 98,156 facts), a full
rescore under the new rules took 148.5 s through local D1 (90 rows/s; the old
rules took 127.7 s, 104 rows/s; the phrases lookup is the extra cost), about
67 calls of 200.

The migration `completeness_rules` brings stored facts to this release's
rules, then bumps every row. On the same copy it ran in 0.76 s and:

| Step | Rule | Rows |
| ---- | ---- | ---- |
| Orphans | live facts of a sense whose gloss was retracted and that has no live gloss, as subject or relation object, retracted | 103 (30 relation, 18 example, 18 translation, 15 collocation, 11 grammar, 11 topic) |
| Periphrastic forms | live `more …` comparatives and `most …` superlatives retracted | 82 (38 on A1 entries) |
| IPA house style | live pronunciation and form ipa rewritten with their content keys; collisions retracted first | 491 pronunciations rewritten (with syllable dots 33, US ɛ 255, ɚ 172, ɝ 73; a row may have several), 0 forms (the 2 form ipas outside the style were periphrastic, retracted), 0 collisions |
| zh translations | ASCII `; , ( )` made fullwidth and repeated alternatives dropped, with the key `zh|` plus the lowercased text; collisions retracted first | 1 rewritten (建造；建造), 0 collisions, 0 with ASCII punctuation |
| Sense lists | published on an uncertain verdict, marked for review in place | 178 |
| Worklist | `revision` bumped | 13,323 |

After it, every live fact's stored content key equals the registry's, and every
live pronunciation, form, and translation passes the new write rules.

The migration `completeness_usage_family` brings stored facts to the usage,
phrase, family, and label rules, marks for review in place what the new rubrics
judge differently, then bumps every row. On a copy of the development database
(14,363 entries, 133,002 facts) it ran in 1.1 s and:

| Step | Rule | Rows |
| ---- | ---- | ---- |
| Base lemmas | a live morphology base part spelled exactly like another live entry's lemma gains that `lemma`, rewritten with the registry's content key | 219 facts (264 parts) |
| Word formations | published, of more than one part, marked for review in place under the synchronic-base rubric | 254 |
| Variant synonyms | live synonyms between an entry and its live spelling variant's entry retracted | 68 |
| Phrases closures | published, marked for review in place | 17 |
| Glosses | published glosses of the common senses (none in a published list's extra, none under a live correction) of A1 and A2 entries, marked for review in place; a fail flags the gloss as weak | 9,572 |
| Sense lists | published, of A1 and A2 entries, marked for review in place | 958 |
| Worklist | `revision` bumped | 14,363 |

After it, every live fact's stored content key equals the registry's. A full
rescore of the copy under these rules took 228.6 s through local D1 (63 rows/s;
the family lookup is the extra cost), about 72 calls of 200. Of its 1,030 A1
entries, 937 had completeness of at least 0.9 (302 complete) under the earlier
rules and 601 (11 complete) under these, mean 0.956 to 0.890: the new rules
open 896 family, 436 phrases, 803 translated-example, 1,033 grammar, and 1,281
collocation gaps the earlier ones never asked for. The
reconcile cron enqueues the marks 500 a run, so the glosses take about twenty
runs; each fact stays public until its new verdict.

The migration `core_verb_phrases` follows the core-verb phrases rule and the
established-phrasal-verb admission rule. It marks for review in place the
published entry fact of every multiword entry an agent created in the last day
that has a live verb sense (a phrasal verb or verb idiom), whose first word is
the lemma of an entry with a live verb sense, and that `lemma_cefr` does not
list; a fail invalidates the entry, which hides the phrase and drops it from
its head's phrases. A pending entry fact is judged by the new rubric when its
review runs. It then bumps every row. On a copy of the development database
(14,603 entries) it ran in 0.5 s and:

| Step | Rule | Rows |
| ---- | ---- | ---- |
| Phrasal verbs | published entry facts, as above, marked for review in place | 320 |
| Worklist | `revision` bumped | 14,603 |

On the same copy the phrases gap (counted verb sense, fewer than three live
phrases, no closure) was open on 377 A1 and 303 A2 entries under the earlier
rule and is on 138 A1 and 128 A2 under this one; the words it leaves are
listed only as another part of speech at A1 or A2 (*fruit*, *truck*, *party*,
*map*, *key*) or as a verb from B1 (*touch*, *shop*, *fish*).

#### Migration to work items

The migrations `work_items` (the `work_items`, `work_leases`, and
`public_hypernyms` tables, the `rare` column of `public_sense_topics` with its
entry index widened to `(entry_id, rare, topic_id)`, and the worklist rebuilt
without its claim columns: `claimed_at`, `stalled`, `awaiting_review`,
`claimed_work`, `claim_rank`, the lease, `last_worked_by`, `last_note`, and the
claim-order index) and `work_items_relation_layers` replace the entry claim.
The latter rewrites every `relations` gap closure, in every status, as a
`synonyms` closure with the registry's content key; marks for review in place
every published synonyms closure, hypernym, and `part_of` that no curator
settled; and bumps every worklist row. The items are not built in SQL: the
rescore drain builds them with `assessEntry`, and the view drain fills
`public_hypernyms` and the topic rows' rarity. On a copy of the development
database (15,825 entries, 157,402 facts) both migrations ran in under 5 s and:

| Step | Rows |
| ---- | ---- |
| Relations closures rewritten as synonyms closures | 1,591 (456 published, 1,135 rejected) |
| Marked for review in place | 10,492 (8,814 hypernym, 1,243 `part_of`, 435 synonyms closures; 21 published closures were already marked) |
| Worklist rows stale | 15,825 |

The rescore drain then took 165 s (about 95 rows/s, 80 calls of 200) and the
view drain 154 s. It built 140,569 items, none awaiting review or with the
curators: by stage, identity 13,737 (5,166 `senses`, 8,571 `sense_list`),
meaning 23,613 (10,576 `translations`, 8,933 `category`, 4,104 `parts`), usage
83,831, network 19,385 (8,469 `synonyms`, 10,121 `topics`, 671 `family`, 124
`phrases`), and 3 weak facts. The 5,166 entries with no sense, 4,238 of them
with a CEFR level (2,169 a CEFR noun), are all stage 1, so their categories
follow their senses. `public_hypernyms` holds 8,059 everyday rows, and 224 of
the 6,198 topic rows are on rare senses.

That revalidation let a confident Jev pass keep everyday hypernyms to technical
taxa and parts of narrower wholes, since Jev settled a pass without the rubric.
Once Jev only gates hypernym and `part_of` (see Relations), the migration
`relation_layer_review` brings the published ones to the rubric:

1. A published everyday hypernym that no curator settled, whose target entry is
   one of a short list of common technical taxa (arthropod, bovine, canine,
   equid, feline, invertebrate, passerine, primate, rodent, ruminant,
   ungulate), gets a pending correction by `admin:migration` with the same
   target in the `biology` domain (content key `hypernym|<target>|biology`),
   unless it already has a live correction or that biology fact is live. The
   biology rubric reviews it, and once it publishes it supersedes the everyday
   fact, so dog keeps canine in the biology layer instead of losing it to a
   failed everyday revalidation. "mammal" is not on the list: it is a category
   learners use, and the everyday rubric decides whether a single animal's
   everyday category is it.
2. Every other published hypernym and `part_of` that no curator settled and
   that has no live correction is marked for review in place; one that fails
   is rejected.
3. Every worklist row is bumped.

On a copy of the development database (15,831 entries) it ran in 2.3 s and
created 15 biology corrections (dog canine and cat feline twice each, horse
equid twice, goat and sheep ruminant, monkey and man primate, rat and mouse
rodent, worm and sponge invertebrate, insect arthropod), marked 9,367 facts
(8,293 hypernym, 1,074 `part_of`), left 5 curated facts alone, and made all
15,831 rows stale.

The learner priority is stored on the row, and copied onto its items as their
rank and `zipf_order`, so a claim stays one index scan.
The row reads it from the reference tables when it is created, in the same batch
as the entry, and every reference import ends by rereading it for every row
(`rankWorklistSql` in `server/adapters/reference-sql.ts`) and re-ranking every
item from it (`rankWorkItemsSql`), so a reimport re-ranks the queue. CEFR is read by the exact lemma and frequency by
`frequency_key`, the rules entry reads use. `frequency_key` is stored because
SQLite's `lower()` folds only ASCII letters, while `frequencyKey` lowercases all
of Unicode. The migrations `worklist_learner_priority` (columns),
`worklist_learner_priority_backfill` (`frequency_key` as `lower(lemma)`, then
the import's update) moved the existing rows over; the backfill's `lower()` matched
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
| `{ type: "sense_list", senses }`         | Some sense has a live gloss, and the current sense list does not name exactly the senses with a live gloss; `senses` names them, oldest first |
| `{ type: "forms", missing }`             | A paradigm slot of a single word has no live form filling it; `missing` names each `{ type, pos }` (see Forms) |
| `{ type: "pronunciation", accents }`     | `us` or `uk` has no live strong pronunciation; `accents` names them |
| `{ type: "phrases", have, need }`        | An A1 or A2 single-word verb has fewer than `need` (3) live phrasal verbs or verb idioms headed by it; `have` names the ones it has |
| `{ type: "family" }`                     | An A1 or A2 single word has no live entry whose morphology names it as a base |
| `{ type: "category", sense_id }`         | A noun sense has no live everyday hypernym to a sense that can show |
| `{ type: "parts", sense_id }`            | A noun sense with an everyday category has no live `part_of` attached to it from a sense that can show |
| `{ type: "synonyms", sense_id }`         | A noun, verb, adjective, or adverb sense has no live synonym or antonym to a sense that can show |
| `{ type: "examples", sense_id, count, need }` | The sense has fewer live examples than `need`: 2 for an A1 or A2 entry, else 1 |
| `{ type: "translations", sense_id, language: "zh" }` | The sense has no live `zh` translation |
| `{ type: "topics", sense_id }`           | A noun or verb sense has fewer live topic facts than it needs (`TOPICS_NEEDED`) |
| `{ type: "morphology" }`                 | A single-word entry has no live word formation          |
| `{ type: "syllables" }`                  | A single-word entry has no live syllables fact          |
| `{ type: "form_pronunciations", forms }` | A live irregular form has no live fact of it with `ipa`; `forms` names them |
| `{ type: "example_translations", sense_id, language: "zh", examples }` | A current live example of the sense has no `zh` translation, or the sense has fewer translated examples than it needs; `examples` names the untranslated ones |
| `{ type: "grammar", sense_id }`          | A noun, verb, adjective, adverb, determiner, or pronoun sense has no live grammar fact |
| `{ type: "collocations", sense_id }`     | A noun, verb, adjective, adverb, determiner, preposition, or conjunction sense has no live collocation |

A weak fact is open work too, `{ type: "weak_fact", fact_id, kind, reason }`
(see Scores). A live `gap_closure` on the gap's node closes `forms`, `phrases`,
`family`, `category`, `parts`, `synonyms`, `topics`, `grammar`, or
`collocations`: the gap is gone and its
slots count as filled. Rules can be strict without stalling a word they do not
fit, while review keeps a closure of a slot that plainly applies out.

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

The relation slots (see Relation slots) are one each: a category, the parts,
a synonym or antonym. A slot is the bar for the gap, not a quota: an agent
submits every relation a learner's dictionary gives in the pass, and only where
one holds.

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
lemmas) and 2,785 have CEFR levels; all 850 seed entries have a frequency and
829 have CEFR levels.

Work items order by CEFR level and frequency within their stage (see Work
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
review, so the queue reviews about 6,000 entries before their items are served.
A repeated call created nothing. The worklist then held 12,029 rows: 7,841 with
a CEFR level, 1,756 with only a frequency, and 1,432 with neither.

## Access

| Surface                   | Who                  | Credential                                   |
| ------------------------- | -------------------- | -------------------------------------------- |
| `/v1/*`, `/openapi.json`, `/docs` | Everyone     | None                                         |
| `/manage/v1/*`, `/manage/openapi.json` | Agents and admins | Agent API key or admin OIDC access token |
| `/manage/v1/agents`       | Admins only          | Admin OIDC access token                      |
| `/manage/v1/facts/{id}/curate`, `curation` on `POST /manage/v1/facts` | Curators: admins and curator agents | Admin OIDC access token or curator agent key |
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
      "pronunciations": [{ "ipa": "rɪˈkɔːrd", "accent": "us" }],
      "forms": { "past": [{ "form": "recorded", "irregular": false }], "present_participle": [{ "form": "recording", "irregular": false }] },
      "senses": [
        {
          "id": "…", "gloss": "…", "labels": [], "rare": false, "translations": ["记录"],
          "grammar": { "transitivity": "transitive", "patterns": [], "prepositions": [] },
          "examples": [{ "text": "…", "translation": "…" }], "collocations": [{ "text": "…", "pattern": "verb_noun" }],
          "topics": [{ "id": "office", "name": { "en": "At the office", "zh": "办公室" } }],
          "relations": { "synonyms": [{ "lemma": "log", "sense_id": "…", "gloss": "…" }],
            "antonyms": [], "broader": [], "narrower": [], "part_of": [], "parts": [] }
        }
      ]
    }
  ],
  "phrases": [{ "lemma": "off the record", "pos": ["noun"], "cefr": null, "gloss": "…", "translation": "…" }]
}
```

- **Meanings.** One meaning per part of speech, in the order of each one's
  first sense in the sense-list order (see Sense lists), with the CEFR level of
  the lemma in that part of speech or `null`.
- **Pronunciations.** The entry's `pronunciations` are the facts without a part
  of speech, the default. A meaning lists only the facts labelled with its part
  of speech, the ones that differ from the default. A weak form keeps
  `strength: "weak"`.
- **Forms.** A meaning's `forms` is an object keyed by inflection type; each
  value lists every published form of that type as `{ form, irregular, ipa?,
  accent? }` (`"past": [{ "form": "dreamed", "irregular": false }, { "form":
  "dreamt", "irregular": true }]`), because a type can have several; `irregular`
  is computed (see Syllables, form pronunciations, and example translations)
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
  that can carry it is published, as a relation waits for its sense. Display
  never limits lookup: `GET /v1/forms/{form}` finds every published form of a
  public entry, shown or not. `variant` forms are the entry's `variants`, with
  their part of speech when labelled.
- **Senses.** `labels` is the register (empty for none), `region` is
  `british` or `american` for a sense only that variety uses (null when both
  do), `rare` marks an
  `extra` sense of the sense list, `grammar` lists `patterns` and
  `prepositions` (empty when none). `relations` groups related senses by what
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
- **Phrases.** Summaries, in lemma order, of the public multiword entries that
  have the lemma as one of their space-separated words, exactly as spelled.
- **Review metadata.** Fact ids, confidence, and verdict appear only with
  `?include=review`: every object a published fact shows gains `review: {
  fact_id, confidence, verdict }`; claims shown as strings have theirs in the
  owner's `review` (a sense's `review.gloss` and `review.translations`, in the
  shape of its translations, a meaning's `review.forms`, the entry's
  `review.entry`, `review.sense_list`, and `review.syllables`). Gap closures
  show only here: the entry's `review.closures` lists each published closure
  of the entry or of a shown sense as `{ gap, sense_id, reason, fact_id,
  confidence, verdict }` (`sense_id` null for an entry gap). Feedback on a fact names it by these
  ids. Sources appear only in `GET /v1/sources`.

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
(`GET /v1/entries`, `GET /v1/forms/{form}`, `GET /v1/topics/{id}/senses`,
`GET /v1/search`) reject it with `400 invalid_request`, so every summary has one shape. A
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
once at its nearest `depth` (1 for a direct kind), as `{ lang, items: [sense
summary + depth], next_cursor }` ordered by depth, lemma, and sense id. "animal"
lists dog, cat, and bird at depth 1 and eagle, through bird, at 2; with
`domain=biology`, "carnivore" lists canine and then dog. It walks the view's
`public_hypernyms` rows (one per broader term a public sense shows, with the
narrower sense's summary) in one recursive query, bounded at `MEMBER_DEPTH`
(12), the depth that also ends a walk round a cycle of three or more entries. A
sense that is not public is `404 not_found`. It is a list, cached for five
seconds like the others.

**Lists.** `GET /v1/entries` takes `prefix`, `level` (CEFR levels, repeated
`level=A1&level=A2` or comma-separated `level=A1,A2`), `pos`, `topic` (a leaf
topic, or a category for any of its leaves), and `sort` (`lemma`, the default,
or `frequency`: most frequent first by the entry's frequency rank, entries
without one last, ties by lemma). `level` and `pos` hold for one meaning: an
entry is listed when one of its meanings has that part of speech and one of
those levels (the CEFR level of the lemma in that part of speech), so
`level=A1&pos=noun` lists the A1 nouns, not entries that are A1 as a verb and
also nouns. With `topic`, they hold for one common sense tagged with the topic,
at the level of its part of speech: a topic on a sense the entry's sense list
puts in `extra` does not list the entry, since a learner browsing the topic
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
| `public_phrase_words` | `word`, `entry_id`                                           | `(word, entry_id)`               |
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
summary; `public_phrase_words` a row per word of a multiword lemma;
`public_morphemes` a row per part of its word formation; and `public_search` a
row per distinct gloss (`field` `gloss`, `scope` `en`), example (`example`,
`en`), and translation (`translation`, its language tag) of a public sense,
whose `body` is the text as the search index stores it (see Search).
`public_search_fts` is an FTS5 table (`unicode61 remove_diacritics 2`) with
`public_search` as its external content: it stores only the index, and two
triggers on `public_search` insert and delete its entries, so a rebuild writes
`public_search` rows like any other. It is a virtual table, which `wrangler d1
export` cannot export: drop `public_search_fts` before an export, and restore it
by running `migrations/20261110034927_public_search_fts.sql` and then `INSERT
INTO public_search_fts(public_search_fts) VALUES ('rebuild')`. An entry whose entry
fact is not published has no rows, so every public read of it is `404`.

| Read                          | Served from                                                    |
| ----------------------------- | -------------------------------------------------------------- |
| `GET /v1/entries/{lemma}`     | One batch: `entries` by lemma with its worklist row and `public_entries` row; the summaries of the entries whose `public_phrase_words` name the lemma; the summaries of the entries whose `public_morphemes` share a base or root with its own; and its parts that are a public lemma |
| `GET /v1/senses/{id}`         | The same statement from `senses`; the sense is cut out of the document |
| `GET /v1/forms/{form}`        | `public_forms` by spelling joined to `public_entries`, in lemma order |
| `GET /v1/entries`             | `public_entries` summaries by lemma range or along `(frequency_order, lemma)`, each checked through the key of `public_meanings`, or with a topic the `(entry_id, topic_id)` index of `public_sense_topics` |
| `GET /v1/topics/{id}/senses`  | `public_sense_topics` summaries by leaf along the index of the sort |
| `GET /v1/search`              | `public_entries` by exact lemma and lemma range, `public_forms` by variant form, and `public_search_fts` joined to `public_search` by rowid, grouped by entry |

Feedback and the management API keep reading the facts: they need every status.

**Linked entries.** Two kinds of data cross entries. A relation's other sense
is part of the stored document: a write to either end bumps the revision of
the entries both senses belong to (see The worklist table), so both views go
stale and are rebuilt. Phrases, the word family, and the part links are joined
on read instead, from rows each entry writes about itself: a new multiword
entry "give up" writes its own `public_phrase_words` rows, and the next read
of "give" finds it, with no rebuild of "give". A changed word formation
replaces the entry's own `public_morphemes` rows, so its old family stops
finding it and its new one starts. No write therefore has to find the entries
that list another entry as a phrase or relative, and none can miss one. These
joins read only built rows, so they lag a write like the lists do.

**Staleness.** The view shares the worklist's `revision`: a view is stale while
`view_revision <> revision` (partial index `worklist_view_stale_idx`). Every
write that can change a document already bumps `revision` in its own batch (see
The worklist table), and `refreshEntries` rebuilds the stale views of the
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
`GET /v1/entries`, `GET /v1/topics/{id}/senses`, and `GET /v1/search` change
whenever any entry in them does; an ETag would need the whole page query before
a `304` could save only the body, so they carry `Cache-Control: public,
max-age=5`, which stays within the budget, and no ETag. Errors and the feedback
POST carry no caching headers.

**Edge cache.** The Worker runs in front of Cloudflare's cache, so the edge
stores nothing by itself; `publicReadBoundary` (`server/http/public-reads.ts`)
puts responses in the Workers Cache API (`caches.default`, the cache of the
colo serving the request) itself, after the read rate limit. It stores exactly
the `200` `GET` responses whose own headers let a shared cache keep them fresh
(`public` with a `max-age`, and no `no-cache`, `no-store`, or `private`): the
three lists. Documents and form lookups are `no-cache`, so they are never
stored: a stored body would still need the same indexed batch to revalidate,
and that batch already answers a matching `If-None-Match` with a bodiless
`304`. The key is the request URL and, when it has no `?lang=`, the served
language its `Accept-Language` reads (`?lang=zh&vary=accept-language` appended),
because the Cache API ignores `Vary` and the body depends on nothing else in
that header; a `?lang=` stays as sent, so a value the route rejects never
shares a key with one it serves. The stored copy drops `Vary` and carries the
`Date` it was stored; a hit is served with `Vary: Accept-Language` restored and
`Age` set from that date, so a browser or downstream cache keeps it only for
what is left of the five seconds. A list is therefore at most five seconds
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
entries whose form keys it rewrote. `completeness_rules` bumps `revision` alone
on every row, since the gap rules changed and every score must be recomputed,
and the documents gain a sense's `region` and the entry's `review.closures`.
Reads of entries and
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
migration, so their views go stale and are rebuilt. `grammar_prepositions` is
the pattern: its first statement bumps the revision of every entry that owned a
live fact it then retracts and rewrites. Deploy such a migration with the drain
above.

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

## Runtime

- One Worker serves the API, the OpenAPI documents, and the console assets.
- D1 stores nodes, facts, the topic taxonomy, feedback, agents, work leases, the public view, and
  imported reference data.
- A Cloudflare Queue carries `{ fact_id, trace_id }` review jobs. Its consumer
  takes batches of up to 100, reviews them concurrently, and logs the trace ID.
  A batch waits for its slowest review, so the batch size is what bounds review
  throughput when producers and revalidations enqueue thousands of facts.
- A cron trigger runs every five minutes, rescores up to 100 stale worklist
  rows, rebuilds up to 100 stale public views, and re-enqueues facts whose last
  status change is more than five minutes old and that are still `pending`, and
  published facts whose
  `revalidate_since` is more than five minutes old, so a lost enqueue cannot
  strand a fact. It keys on `updated_at`, not `created_at`, so a re-reviewed fact counts
  from its reset.
- A reviewer transport failure (network, 429, 5xx) retries the message with a
  delay; after five attempts it lands in the `vocnet-reviews-dlq` dead letter
  queue, and the cron keeps re-enqueueing the fact until review succeeds.
