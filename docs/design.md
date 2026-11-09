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

A partial unique index on `(kind, subject_id, content_key)` over `pending` and
`published` rows makes resubmission return the existing fact.

### Fact kinds

The registry in `server/domain/fact-kinds.ts` is the single source of truth.
Each kind declares its subject type, payload schema, content key, reviewer, and
review prompt. Adding a kind is one registry entry plus a migration only if it
needs a new column.

| Kind            | Subject | Payload                                    | Reviewer |
| --------------- | ------- | ------------------------------------------ | -------- |
| `entry`         | entry   | `{}` (the lemma is an established word)    | Jev      |
| `sense`         | sense   | `{ gloss }`                                | Jev      |
| `form`          | entry   | `{ form, type }` (plural, past, variant…)  | Jev      |
| `relation`      | sense   | `{ type, target_sense_id }`                | Jev      |
| `pronunciation` | entry   | `{ ipa, accent }`                          | LLM      |
| `example`       | sense   | `{ text }`                                 | LLM      |
| `translation`   | sense   | `{ language, text }`                       | LLM      |

Relation types are `synonym`, `antonym`, `hypernym`, and `part_of`, with the
same review questions the producer qualified.

### Fact lifecycle

```
           submit
             │
             ▼
         ┌────────┐  review fail   ┌──────────┐
         │pending │───────────────▶│ rejected │
         └────────┘                └──────────┘
             │ review pass/uncertain
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

### Reviews

- **Jev** gets typed `noul` questions at `POST {MODEL_BASE_URL}/v1/systemone`
  and returns a probability per question. Every answer at or above 0.8 is
  `pass`, any answer at or below 0.2 is `fail`, anything else is `uncertain`.
  Confidence is the minimum answer.
- **LLM** gets a rubric prompt at the OpenAI-compatible chat completions
  endpoint and must return JSON `{ verdict, confidence, reason }`.
- The review stores the context it judged (lemmas and glosses of referenced
  senses) so a later reader knows what was approved.
- A transport failure is not a verdict. The fact stays `pending`, and the queue
  retries it.

## Feedback

Anyone can report a problem with an entry, a sense, or a fact through the
public API. Feedback moves through `open → claimed → resolved | dismissed`.
An agent claims a feedback item with a one-hour lease, so two agents do not
work the same report. An expired claim can be claimed again. Resolving links
the correcting fact IDs.

## Access

| Surface                   | Who                  | Credential                                   |
| ------------------------- | -------------------- | -------------------------------------------- |
| `/v1/*`, `/docs`          | Everyone             | None                                         |
| `/manage/v1/*`            | Agents and admins    | Agent API key or admin OIDC access token     |
| `/manage/v1/agents`       | Admins only          | Admin OIDC access token                      |
| Admin console (SPA)       | Admins               | OIDC Authorization Code + PKCE               |

Admins are OIDC subjects listed in `ADMIN_SUBJECTS`. Agent keys are random
secrets that an admin issues in the console. The Worker stores only their
SHA-256 hash.

## Runtime

- One Worker serves the API, the OpenAPI documents, and the console assets.
- D1 stores nodes, facts, feedback, and agents.
- A Cloudflare Queue carries `{ factId }` review jobs. Its consumer reviews.
- A cron trigger re-enqueues facts that stayed `pending` longer than ten
  minutes, so a lost enqueue cannot strand a fact.
