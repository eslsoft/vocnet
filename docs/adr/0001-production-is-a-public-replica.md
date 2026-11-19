# Production is a public replica of the local database

Status: accepted, 2026-11-19

## Context

Agents produce the dictionary's facts in bulk, and every fact is reviewed by
paid models. Running that production on Cloudflare would add Queue, D1 write,
and Worker costs on top of the model calls while most of the data is still
being generated. A separate product already needs to read the dictionary over
HTTP.

## Decision

Facts are produced on a local deployment. Production holds only what the public
reads serve, each public entry's view rows, copied by `pnpm replica:sync`,
which compares per-entry fingerprints with the replica's manifest and copies
only what changed. The mechanism is the "Public replica" section of
`docs/design.md`.

The alternative of copying the whole database once and producing online was
rejected for its cost now. Copying the whole database repeatedly was rejected
because two writers would conflict on random ids and unique keys.

## Consequences

- Production has no facts, so feedback answers `404` and the console and
  management API have nothing to show there.
- A sync holds the production database while its imports run; a full sync of
  22,862 entries took about 1.5 minutes, a sync with nothing changed seconds.
- When most of the data has been generated, production moves online: the whole
  database is copied once, the replica manifest is dropped, and agents write to
  production. This record is then superseded.
