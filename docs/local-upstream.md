# Running Vocnet locally as an upstream

A downstream product (Wordkith is the first) reads all its dictionary data from
Vocnet's public `/v1` API. This is how to run a local Vocnet with the real data
for such a consumer to develop and be accepted against. The contract of every
read is [design.md](design.md#public-api); the generated reference is `/docs`
and `/openapi.json` on the running server.

## What runs

One process: the Worker in `workerd`, started by Vite, with the local D1
database. Nothing else is needed to read.

- The data is the D1 SQLite file under `.wrangler/state` of the checkout that
  holds it (the main checkout, `~/Develop/bogit/eslsoft/vocnet`). It is not in
  git and a fresh worktree has none.
- Reads need no cron and no queue. An entry or sense read rebuilds its own
  public view when it is stale, and the lists read the views already built.
- Do not start `scripts/local/cron-loop.sh` for a consumer. It triggers the
  scheduled handler, which is production: it re-enqueues reviews and classifies
  work with the model gateway. Run it only when you mean to run production.

## Start the server

From the checkout that holds the data:

```bash
pnpm install
pnpm db:migrate:local      # only when migrations were added; stop the server first
pnpm build
pnpm exec vite preview --port 5173 --strictPort
```

`vite preview` serves the production build on `http://127.0.0.1:5173`; rebuild
and restart to pick up code changes. `.dev.vars` must exist (copy
`.dev.vars.example`); reads use none of its secrets, but the Worker parses the
file's review settings on every request.

To serve the same data from another checkout or a worktree, point it at the
state directory and give it a copy of `.dev.vars`. Only one server may have the
database open, so stop the other first:

```bash
VOCNET_PERSIST=~/Develop/bogit/eslsoft/vocnet/.wrangler/state \
  pnpm exec vite preview --port 5173 --strictPort
```

Check it:

```bash
curl -s http://127.0.0.1:5173/v1/entries/bright | head -c 200
```

## The service key

A consumer's backend reads with a service key. The key names the service in the
access log and moves its reads from the per-address limit (120 a minute per
`CF-Connecting-IP`) to the per-service one (6000 a minute), wherever the calls
come from. It grants nothing else, and the responses are the same as without it.

Issue one for local development with the server stopped. The script inserts the
service row (only the SHA-256 of the key is stored) and writes the key to a
file only you can read; it never prints the key:

```bash
scripts/local/issue-service-key.sh wordkith-dev ~/.vocnet/keys/wordkith-dev.key
```

Set `VOCNET_PERSIST` as above when the data is another checkout's. On a
deployed Vocnet, and locally when you are signed in as an admin, a key is issued
through the management API and shown once:

```bash
curl -s -X POST "$VOCNET/manage/v1/services" \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -H 'content-type: application/json' -d '{"name":"wordkith"}'
# { "service": { "id": "…", "name": "wordkith", … }, "key": "vn_service_…" }
```

`GET /manage/v1/services` lists the services and `DELETE
/manage/v1/services/{id}` revokes one; a revoked or unknown key is `401
invalid_credential` on `/v1`, never an anonymous read.

## Calling it from the consumer

```bash
export VOCNET_API_URL=http://127.0.0.1:5173
export VOCNET_API_KEY=$(cat ~/.vocnet/keys/wordkith-dev.key)
curl -s -H "Authorization: Bearer $VOCNET_API_KEY" \
  "$VOCNET_API_URL/v1/overviews?lemma=bright&lemma=run&lang=zh"
```

- Keep the key out of the repository and out of logs: read it from the file or
  from an untracked env file.
- From a Docker container use `http://host.docker.internal:5173`. Vite allows
  that host name, and a keyed read needs no `CF-Connecting-IP`.
- A read without a key works locally too: Miniflare fills `CF-Connecting-IP`
  from the socket address, so every keyless caller on the machine shares one
  120-a-minute allowance. A backend that proxies many users must send its key.
- Lists (`/v1/entries`, `/v1/search`, `/v1/topics`, `/v1/topics/{id}/senses`,
  `/v1/overviews`, `/v1/senses/{id}/members`) are `Cache-Control: public,
  max-age=5`; `/v1/overviews` and `/v1/topics` also carry an ETag and answer
  `If-None-Match` with `304`. Documents (`/v1/entries/{lemma}`, `/v1/senses/{id}`,
  `/v1/sentences/{id}`, `/v1/forms/{form}`) are `no-cache` with a strong ETag:
  send `If-None-Match` and a `304` costs one indexed lookup.
- Translations and topic names follow `?lang=` (else `Accept-Language`), and
  the response's `lang` says which language was read. Cache by URL and language.
- `429 rate_limited` carries `Retry-After`; `404 not_found` means no public
  entry is spelled exactly so. There is no fuzzy or case-folding fallback.

## What the local data holds

Counted on 2026-11-15, with production stopped:

| What | Count |
| --- | --- |
| Public entries | 22,862 |
| of them single words | 8,705 (8,548 with both a US and a UK pronunciation) |
| of them phrases | 14,157 (phrase production has not run; most have a gloss and little else) |
| Public senses of single words | 30,550 (29,791 with a Chinese translation, 29,789 with an example) |
| Topics | 16 categories over 147 leaf topics, every leaf with tagged senses |
| Senses tagged with a topic | 13,224, of 5,873 entries |
| Sentences | 42,758 (41,065 shown as an example of a public sense) |
| Hypernym links (the kinds trees) | 9,702; "person" has 388 kinds over 4 levels |

Words are the complete part. A phrase entry reads through the same API, but
expect sparse documents until phrase production runs.
