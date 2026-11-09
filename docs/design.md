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
  proposition go to Jev. Facts whose quality is a judgment go to a general LLM.
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
| `senses`  | `id`, `entry_id`, `pos`, `created_by`             | POS is identity; gloss is a fact    |

Correcting a sense's POS means a new sense, not an edit. A node is publicly
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
| `supersedes_id` | Fact this one corrects, if any                                 |
| `author`        | Agent or admin principal that submitted it                     |
| `review`        | Reviewer, verdict, confidence, reason, raw detail, reviewed at |

A partial unique index on `(kind, content_key, subject_id)` over `pending` and
`published` rows (the *live* facts) makes resubmission return the existing
fact. `content_key` precedes `subject_id` so lookups by content, such as finding
the entries that own a form, use the same index.

### Fact kinds

The registry in `server/domain/fact-kinds.ts` is the single source of truth.
Each kind declares its subject type, payload schema, content key, reviewer, and
review prompt. Adding a kind is one registry entry plus a migration only if it
needs a new column.

| Kind            | Subject | Cardinality | Payload                                   | Reviewer |
| --------------- | ------- | ----------- | ----------------------------------------- | -------- |
| `entry`         | entry   | one         | `{}` (the lemma is an established word)   | Jev      |
| `sense`         | sense   | one         | `{ gloss }`                               | Jev      |
| `form`          | entry   | many        | `{ form, type }` (plural, past, variant…) | Jev      |
| `relation`      | sense   | many        | `{ type, target_sense_id }`               | Jev      |
| `pronunciation` | entry   | many        | `{ ipa, accent }` (accent `us` or `uk`)   | LLM      |
| `example`       | sense   | many        | `{ text }`                                | LLM      |
| `translation`   | sense   | many        | `{ language, text }` (BCP 47 tag)         | LLM      |

A kind with cardinality *one* admits a single live fact per subject: a sense has
one gloss. Changing it means submitting a correction that supersedes the
published fact; a second gloss without `supersedes_id` is a conflict.

Relation types are `synonym`, `antonym`, `hypernym`, and `part_of`, with the
same review questions the producer qualified. A relation is reviewed with the
relation question only. Whether each sense is an established meaning is the
job of that sense's own `sense` fact, and the relation stays hidden until both
are published.

### Fact lifecycle

```
           submit
             │
             ▼
         ┌────────┐  review fail   ┌──────────┐
         │pending │───────────────▶│ rejected │
         └────────┘                └──────────┘
             │ review pass/uncertain       (retract also applies to pending;
             │                              admin re-review returns published
             │                              or rejected facts to pending)
             ▼
        ┌──────────┐ correction published ┌────────────┐
        │published │─────────────────────▶│ superseded │
        └──────────┘                      └────────────┘
             │ retract
             ▼
        ┌──────────┐
        │retracted │
        └──────────┘
```

The transition table lives in the domain. Review writes are conditional on
`status = 'pending'`, so a duplicate queue delivery cannot change a decided fact.
A correction (`supersedes_id`) is reviewed like any fact. When it publishes,
the superseded fact changes status in the same D1 batch. A rejected correction
leaves the original published.

An author can retract its own pending or published fact; admins can retract
any. An admin can re-review a published or rejected fact: it returns to
`pending` and is enqueued, unless a rejected fact's slot has since been taken
by another live fact.

### Reviews

- **Jev** gets typed `noul` questions at `POST {MODEL_BASE_URL}/v1/systemone`
  and returns a probability per question. Every answer at or above 0.8 is
  `pass`, any answer at or below 0.2 is `fail`, anything else is `uncertain`.
  Confidence is the minimum answer.
- **LLM** gets a rubric prompt at the OpenAI-compatible chat completions
  endpoint and must return JSON `{ verdict, confidence, reason }`.
- The review stores the context it judged (lemmas and glosses of referenced
  senses) so a later reader knows what was approved.
- A sense's current gloss is its published `sense` fact, or until one
  publishes, its pending one. That keeps examples, translations, and relations
  from waiting on the gloss. A meaning-dependent fact whose sense has no live
  gloss at all is rejected as unreviewable without calling a reviewer.
- A transport failure is not a verdict. The fact stays `pending`, and the queue
  retries it.

## Feedback

Anyone can report a problem with an entry, a sense, or a fact through the
public API. Feedback moves through `open → claimed → resolved | dismissed`.
An agent claims a feedback item with a one-hour lease, so two agents do not
work the same report. An expired claim can be claimed again by anyone, and the
holder can renew its claim at any time. Only the holder resolves (linking the
correcting fact IDs) or dismisses (with a note). Every feedback write is a
compare-and-set on a revision counter.

## Access

| Surface                   | Who                  | Credential                                   |
| ------------------------- | -------------------- | -------------------------------------------- |
| `/v1/*`, `/openapi.json`, `/docs` | Everyone     | None                                         |
| `/manage/v1/*`, `/manage/openapi.json` | Agents and admins | Agent API key or admin OIDC access token |
| `/manage/v1/agents`       | Admins only          | Admin OIDC access token                      |
| Admin console (SPA)       | Admins               | OIDC Authorization Code + PKCE               |

Admins are OIDC subjects listed in `ADMIN_SUBJECTS`. Agent keys are random
secrets (`vn_agent_…`) that an admin issues. The Worker stores only their
SHA-256 hash. A valid OIDC token whose subject is not an admin gets 403.

## Console

The console is how admins watch the dictionary. It reads and acts only through
`/manage/v1` with the admin's access token.

- **Overview**: fact counts by kind and status, and open feedback.
- **Facts**: a filterable, paged list with a drawer for one fact's payload,
  author, review, and the fact it supersedes. Admins retract or re-review there.
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
- D1 stores nodes, facts, feedback, and agents.
- A Cloudflare Queue carries `{ factId }` review jobs. Its consumer reviews.
- A cron trigger re-enqueues facts whose last status change is more than ten
  minutes old and that are still `pending`, so a lost enqueue cannot strand a
  fact. It keys on `updated_at`, not `created_at`, so a re-reviewed fact counts
  from its reset.
- A reviewer transport failure (network, 429, 5xx) retries the message with a
  delay; after five attempts it lands in the `vocnet-reviews-dlq` dead letter
  queue, and the cron keeps re-enqueueing the fact until review succeeds.
