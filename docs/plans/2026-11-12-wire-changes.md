# Wire changes for the production redesign (2026-11-12)

Companion to `2026-11-12-production-redesign.md`. This is the contract the producer adapts to. The
authoritative schemas are `shared/*.ts` and `GET /manage/openapi.json` once the server ships them;
this note fixes the shape and the semantics in advance. Field names are snake_case on the wire.

## Simplifications on top of the plan
- **No provisional senses.** Workers never create entries, and the queue runs a whole batch's stage 1
  (sense inventories) before its relation stages, so every relation target in an admitted entry has
  a published inventory by then. A relation to an entry without one is not submitted: the pass
  records the target as `blocked_on` (below), and the item reopens when that inventory publishes.
- **No `entry` fact kind.** Headwords are admitted by import; phrase entries by their headword's
  published `phrases` fact. An entry is live when it is an imported headword or a phrase listed in a
  published `phrases` fact.

## Fact kinds

| kind | subject | cardinality | payload | review |
|---|---|---|---|---|
| `senses` (new, replaces `sense` + `sense_list`) | entry | one | `{ senses: [{ id?, pos, gloss, register?, region?, rank: "common" \| "extra" }] }` in display order (common first) | Jev per gloss, then LLM on the whole inventory |
| `form` | entry | many | unchanged | Jev → LLM |
| `relation` | sense | many | unchanged | Jev → LLM (antonym pass ≥ 0.9) |
| `pronunciation` | entry | many | unchanged | LLM |
| `syllables` | entry | one | unchanged | luna → LLM |
| `morphology` | entry | one | unchanged | Jev → LLM |
| `grammar` | sense | one | unchanged | Jev → LLM |
| `topic` | sense | many (≤ 3) | unchanged | mean(Jev, luna) → LLM |
| `collocation` | sense | many (≤ 5) | unchanged | LLM |
| `example` | sense | many | `{ text }` (no `translations`) | LLM |
| `translation` (reshaped) | the translated node: a sense, an example fact, or a collocation fact | one per subject and language | `{ language: "zh", of: "sense" \| "example" \| "collocation", text }` | Jev or luna → LLM |
| `phrases` (new) | entry | one | `{ phrases: [lemma] }` (multiword lemmas, no cap) | Jev per phrase, then LLM |

Removed kinds: `entry`, `sense`, `sense_list`, `gap_closure`.

### `senses` inventory
- `id` names an existing sense of the entry to keep it (its relations, examples, translations stay
  attached). Omit `id` for a new sense: publishing the inventory creates the sense and returns its id.
  A sense of the entry missing from the published inventory is gone, and so is everything attached
  to it.
- Only items of type `senses` submit it. After it publishes, workers cannot change it; a correction
  is curator-only (403 `curated_fact` otherwise).
- `POST /manage/v1/senses` is removed.

### `translation`
- `of` says what is translated; `subject_id` is then the sense id (its learner equivalent), the example
  fact id, or the collocation fact id. One live translation per subject and language: change it by
  superseding it.
- The `translations` item's context carries the entry view (every sense, example and collocation
  with its text). Gaps `phrases`, `family`, `morphology`, `syllables` carry only `{ type }`.
  `context.rejections` is an array of facts (with their reviews).
  When the example or collocation is superseded, its translation stops showing and the entry's
  translations item reopens for the new fact.

### `phrases`
- Lists every phrase of the headword that meets the admission rule. Publishing it creates any missing
  phrase entry (seeded at the headword's batch) and makes it live; the phrase entries then get their
  own items. A phrase may be listed by several headwords.
- `POST /manage/v1/entries` is removed for agents (curator and import only).

## Work items

### Gap types
Required (an item stays open until filled):
`senses` (entry has no live inventory), `forms`, `pronunciation`, `form_pronunciations`,
`morphology`, `syllables`, `examples`, `translations`.

Optional (one honest pass completes them):
`phrases`, `family`, `category`, `parts`, `synonyms`, `topics`, `grammar`, `collocations`.

Changes:
- `senses` replaces `senses` + `sense_list`; its context carries the entry view.
- `translations` is per entry and language: `{ type: "translations", language: "zh", missing: [{ of: "sense" | "example" | "collocation", id }] }`. Replaces `translations` (per sense) and `example_translations`.
- `weak_fact` is removed (weak facts become curator tickets).
- No gap descriptions mention `gap_closure` any more.

### Passes and attempts
- `POST /manage/v1/work/{lease}/complete` items: `{ id, note?, found_none?: boolean, blocked_on?: [lemma] }`.
  - For an optional gap, a pass that finds nothing to submit sends `found_none: true` with `note`
    (what was considered and why none fits, ≤ 500 chars; `found_none` without `note` is 400).
    `blocked_on` (≤ 20) lists lemmas that would fit but are not live entries or have no published
    inventory yet. The slot is recorded as passed and the item closes; it reopens when a
    `blocked_on` lemma is imported.
  - `found_none` or `blocked_on` on a **required** gap is 400 `invalid_request`.
  - `note` stays optional for other passes.
- An item gets **at most 2 passes**. A pass makes progress only if the item's filled count grew once
  its reviews settled. After the second pass without the gap filled, the item leaves the queue as a
  ticket. `attempts` and `WorkItemState` change accordingly: `curation` becomes `ticket`.
- The claim context's `criteria.jev` is renamed `criteria.decision`: `{ models: ["jev"|"luna", …], questions, rule }`.
- The claim context gains `rejections`: the item's rejected facts from earlier passes with their
  review reasons, so the retry addresses them.

### Submissions
- Submitting content (kind, subject, content key) that was already rejected returns
  **409 `rejected_before`** with the earlier review, without a new review. Treat it like any other
  409: fix the content, do not resend it.
- Submitting a `senses` inventory for an entry that already has a published one returns
  **403 `inventory_settled`** for anyone but a curator: the inventory is decided once.

## Tickets (replace curation and feedback)
- `GET /manage/v1/tickets?status=&type=` (oldest first): `{ items: [{ id, type: "stuck_work" | "feedback" | "audit" | "missing_word", target_type: "entry"|"sense"|"fact"|"lemma", target, message, status: "open"|"resolved"|"dismissed", resolution_note, resolution_fact_ids, created_at, updated_at, entry: { id, lemma } | null }], next_cursor }`; `GET /manage/v1/tickets/{id}`.
- `POST /manage/v1/tickets/{id}/resolve` (curators): `{ resolution: "resolved", fact_ids?, note }` or `{ resolution: "dismissed", note }`.
- `POST /manage/v1/entries/{id}/passes` (curators): `{ type, subject_id, note }` settles a slot nothing can fill (required ones included); 204.
- `GET /manage/v1/work/curation` and the `/manage/v1/feedback` queue endpoints are removed. The public
  `POST /v1/feedback` stays and opens a `feedback` ticket.

## Producer impact summary
- Delete the feedback loop.
- Never call `POST /entries` or `POST /senses`; the `senses` item submits one inventory.
- Translation items translate every listed target in one language.
- Optional items: submit what exists; otherwise complete with `note` (+ `blocked_on`).
- Use `rejections` on a retry; handle 409 `rejected_before` and 403 `inventory_settled`.
- Read `criteria.decision` instead of `criteria.jev`.
