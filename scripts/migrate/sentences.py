"""One-off data migration for sentences and typed phrases (docs/plans/2026-11-13-sentences-wire.md §7).

Run after migration 20261113190330_sentences is applied, with the server stopped and a backup taken:

    python3 -I scripts/migrate/sentences.py <d1.sqlite> <report-dir> [--dry-run]

It rewrites the store in one transaction:
  2. examples: every example fact (any status) names its sentence, found or created by text key;
     the payload is { sentence_id }, object_id the sentence, the content key the sentence id. Two
     live examples of one sense with one sentence keep the older; the other is superseded.
  3. example translations: every translation with of "example" is about the example's sentence,
     of "sentence", its content key recomputed. Several live translations of one sentence in one
     language keep the earliest published one (else the earliest pending one); the rest are
     superseded.
  4. phrases lists: every list in the untyped shape (any status) becomes items typed idiom naming
     the entries of its lemmas, marked migrated (provisional types: it types no phrase entry and
     fills no phrases slot). A lemma with no entry (only in a list that never published) gets one,
     not live, as a submission naming it by text would. The phrases passes go, so every headword's
     phrases slot reopens and producers submit typed corrections that supersede the migrated lists.
  5. open stuck_work tickets on the senses items of multiword entries are dismissed with a note,
     and those items' attempts reset to 0.
  6. fabulate, bereftly, exaltedly, evokingly, genomically, and misdemanour are retired: not live,
     unless a published phrases list names one as an entry item.
  7. every worklist row's revision is bumped, so the rescore and the view rebuild follow.

--dry-run does all of it inside the transaction, prints the report and the consistency checks,
and rolls back. The report dir gets report.json.
"""

import json
import os
import re
import sqlite3
import sys
import unicodedata
import uuid
from collections import defaultdict
from datetime import datetime, timezone

NOW = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.') + f'{datetime.now(timezone.utc).microsecond // 1000:03d}Z'
LIVE = ('pending', 'published')
RETIRED = ('fabulate', 'bereftly', 'exaltedly', 'evokingly', 'genomically', 'misdemanour')
DISMISS_NOTE = (
    'Dismissed by the sentences migration: the inventory rules for idioms and technical-only entries '
    'were fixed and phrase entries got per-type slots; the item is back in the queue.'
)


def normalize_term(raw):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', raw).strip())


def text_key(raw):
    return normalize_term(raw).lower()


def counts(q):
    rows = q('select kind, status, count(*) as n from facts group by kind, status order by kind, status').fetchall()
    return {f"{row['kind']}/{row['status']}": row['n'] for row in rows} | {
        'sentences': q('select count(*) from sentences').fetchone()[0],
        'live_entries': q('select count(*) from worklist where live = 1').fetchone()[0],
        'open_tickets': q("select count(*) from tickets where status = 'open'").fetchone()[0],
    }


def main(path, report_dir, dry_run):
    db = sqlite3.connect(path, isolation_level=None)
    db.row_factory = sqlite3.Row
    q = db.execute
    if not q("select 1 from sqlite_master where type = 'table' and name = 'sentences'").fetchone():
        raise SystemExit('Apply migration 20261113190330_sentences first.')
    report = {'before': counts(q)}

    q('begin')
    try:
        migrate(q, report)
        report['after'] = counts(q)
        report['checks'] = check(q)
    except BaseException:
        q('rollback')
        raise
    failed = [name for name, value in report['checks'].items() if value]
    if dry_run or failed:
        q('rollback')
    else:
        q('commit')
    report['committed'] = not dry_run and not failed
    print(json.dumps(report, indent=2, ensure_ascii=False))
    os.makedirs(report_dir, exist_ok=True)
    with open(os.path.join(report_dir, 'report.json'), 'w') as out:
        json.dump(report, out, indent=2, ensure_ascii=False)
    if failed:
        raise SystemExit(f'consistency checks failed: {failed}; nothing was written')


def migrate(q, report):
    # 2. Examples onto sentences.
    sentences = {row['text_key']: row['id'] for row in q('select id, text_key from sentences')}
    created = []
    examples = [dict(row) for row in q("select * from facts where kind = 'example' order by created_at, id")]
    example_sentence = {}
    rewrites = []
    for fact in examples:
        payload = json.loads(fact['payload'])
        if 'sentence_id' in payload:
            example_sentence[fact['id']] = payload['sentence_id']
            continue
        text = normalize_term(payload['text'])
        key = text_key(text)
        sentence = sentences.get(key)
        if sentence is None:
            sentence = str(uuid.uuid4())
            sentences[key] = sentence
            created.append((sentence, text, key, fact['author'], fact['created_at']))
        example_sentence[fact['id']] = sentence
        rewrites.append((json.dumps({'sentence_id': sentence}, separators=(',', ':')), sentence, sentence, fact['id']))
    for row in created:
        q('insert into sentences (id, text, text_key, source, created_by, created_at) values (?, ?, ?, null, ?, ?)', row)
    # Two live examples of one sense naming one sentence: the older stays, the other is superseded.
    seen = {}
    example_collisions = 0
    for fact in examples:
        if fact['status'] not in LIVE:
            continue
        slot = (fact['subject_id'], example_sentence[fact['id']])
        if slot in seen:
            q("update facts set status = 'superseded', updated_at = ? where id = ?", (NOW, fact['id']))
            example_collisions += 1
        else:
            seen[slot] = fact['id']
    for payload, object_id, content_key, fact_id in rewrites:
        q('update facts set payload = ?, object_id = ?, content_key = ? where id = ?', (payload, object_id, content_key, fact_id))
    report['examples'] = {'rewritten': len(rewrites), 'sentences_created': len(created), 'collisions_superseded': example_collisions}

    # 3. Example translations onto sentences.
    translations = [
        dict(row)
        for row in q(
            "select * from facts where kind = 'translation' and json_extract(payload, '$.of') = 'example' order by created_at, id"
        )
    ]
    orphans = 0
    moved = []
    for fact in translations:
        payload = json.loads(fact['payload'])
        sentence = example_sentence.get(fact['subject_id'])
        if sentence is None:
            orphans += 1
            sentence = None
        payload['of'] = 'sentence'
        key = f"{payload['language']}|sentence|{text_key(payload['text'])}"
        moved.append({**fact, 'subject_id': sentence or fact['subject_id'], 'payload': payload, 'content_key': key, 'orphan': sentence is None})
    # One live translation per sentence and language: the earliest published, else the earliest pending.
    by_slot = defaultdict(list)
    for fact in moved:
        if fact['status'] in LIVE and not fact['orphan']:
            by_slot[(fact['subject_id'], fact['payload']['language'])].append(fact)
    existing = defaultdict(list)
    for row in q(
        "select id, subject_id, status, json_extract(payload, '$.language') as language, created_at from facts "
        "where kind = 'translation' and json_extract(payload, '$.of') = 'sentence' and status in ('pending', 'published')"
    ):
        existing[(row['subject_id'], row['language'])].append(dict(row))
    superseded = set()
    for slot, facts in by_slot.items():
        candidates = sorted(existing[slot] + facts, key=lambda fact: (fact['status'] != 'published', fact['created_at'], fact['id']))
        for fact in candidates[1:]:
            superseded.add(fact['id'])
    for fact in moved:
        status = fact['status']
        if fact['orphan'] and status in LIVE:
            status = 'retracted'
        elif fact['id'] in superseded:
            status = 'superseded'
        q(
            'update facts set subject_id = ?, payload = ?, content_key = ?, status = ?, updated_at = ? where id = ?',
            (
                fact['subject_id'],
                json.dumps(fact['payload'], ensure_ascii=False, separators=(',', ':')),
                fact['content_key'],
                status,
                fact['updated_at'] if status == fact['status'] else NOW,
                fact['id'],
            ),
        )
    report['translations'] = {
        'moved': len(moved),
        'superseded_duplicates': len(superseded),
        'orphans_retracted': sum(1 for fact in moved if fact['orphan'] and fact['status'] in LIVE),
        'orphans_kept_decided': sum(1 for fact in moved if fact['orphan'] and fact['status'] not in LIVE),
    }

    # 4. Phrases lists into provisional typed items.
    entries = {row['lemma']: row['id'] for row in q('select id, lemma from entries')}
    lists = [dict(row) for row in q("select * from facts where kind = 'phrases'")]
    converted = 0
    created_entries = []
    for fact in lists:
        payload = json.loads(fact['payload'])
        phrases = payload['phrases']
        if not phrases or not isinstance(phrases[0], str):
            continue
        items = []
        for lemma in phrases:
            lemma = normalize_term(lemma)
            entry = entries.get(lemma)
            if entry is None:
                if fact['status'] == 'published':
                    raise SystemExit(f"published phrases list {fact['id']} names {lemma!r}, which has no entry")
                # As a submission naming a phrase by text does: its entry is created, not live.
                entry = str(uuid.uuid4())
                entries[lemma] = entry
                created_entries.append((entry, lemma, fact['author'], fact['created_at']))
            items.append({'type': 'idiom', 'entry_id': entry})
        key = '|'.join(sorted(f"{item['type']}:{item['entry_id']}" for item in items))
        q('update facts set payload = ?, content_key = ? where id = ?', (
            json.dumps({'phrases': items, 'migrated': True}, separators=(',', ':')),
            key,
            fact['id'],
        ))
        converted += 1
    level_rank = (
        "(select min(case level when 'A1' then 1 when 'A2' then 2 when 'B1' then 3 when 'B2' then 4 "
        "when 'C1' then 5 when 'C2' then 6 end) from lemma_cefr where lemma_cefr.lemma = entries.lemma)"
    )
    for entry, lemma, author, created_at in created_entries:
        q('insert into entries (id, lemma, created_by, created_at) values (?, ?, ?, ?)', (entry, lemma, author, created_at))
        q(
            'insert into worklist (entry_id, created_at, live, batch, frequency_key, level_rank, zipf, completeness, credibility, '
            'slots_total, slots_published, slots_pending, revision, scored_revision, view_revision, last_worked_at) '
            f'select id, created_at, 0, null, lower(lemma), {level_rank}, '
            '(select zipf from word_frequency where word_frequency.word = lower(entries.lemma)), 0, 1, 0, 0, 0, 0, 0, 0, null '
            'from entries where id = ?',
            (entry,),
        )
    passes = q("select count(*) from work_passes where type = 'phrases'").fetchone()[0]
    q("delete from work_pass_blocks where type = 'phrases'")
    q("delete from work_passes where type = 'phrases'")
    report['phrases'] = {
        'lists_converted': converted,
        'entries_created_not_live': len(created_entries),
        'passes_deleted': passes,
    }

    # 5. Stuck senses items of multiword entries.
    stuck = [
        dict(row)
        for row in q(
            "select tickets.id, tickets.target from tickets join entries on entries.id = tickets.target "
            "where tickets.type = 'stuck_work' and tickets.status = 'open' and tickets.target_type = 'entry' "
            "and tickets.message like 'senses:%' and entries.lemma like '% %'"
        )
    ]
    for ticket in stuck:
        q(
            "update tickets set status = 'dismissed', resolution_note = ?, revision = revision + 1, updated_at = ? where id = ?",
            (DISMISS_NOTE, NOW, ticket['id']),
        )
        q(
            "update work_items set attempts = 0, worked = 0, found_none = 0 where type = 'senses' and subject_id = ?",
            (ticket['target'],),
        )
    report['stuck_senses_tickets_dismissed'] = len(stuck)

    # 6. Retire the cold words through the retire rule: not live, unless a published list names one.
    retired = []
    for lemma in RETIRED:
        entry = entries.get(lemma)
        if entry is None:
            continue
        named = q(
            "select 1 from facts as list, json_each(list.payload, '$.phrases') as item where list.kind = 'phrases' "
            "and list.status = 'published' and json_extract(item.value, '$.entry_id') = ?",
            (entry,),
        ).fetchone()
        if named:
            report.setdefault('retire_refused', []).append(lemma)
            continue
        if q('update worklist set live = 0 where entry_id = ? and live = 1', (entry,)).rowcount:
            retired.append(lemma)
    report['retired'] = retired

    # 7. Every entry is rescored and its view rebuilt.
    q('update worklist set revision = revision + 1')


def check(q):
    """Each check names what is inconsistent; an empty one passes."""
    one = lambda sql: [tuple(row) for row in q(sql).fetchall()][:20]  # noqa: E731
    return {
        'example_without_sentence': one(
            "select id from facts where kind = 'example' and (object_id is null or object_id <> json_extract(payload, '$.sentence_id') "
            'or not exists (select 1 from sentences where sentences.id = facts.object_id))'
        ),
        'published_example_without_sentence': one(
            "select id from facts where kind = 'example' and status = 'published' "
            'and not exists (select 1 from sentences where sentences.id = facts.object_id)'
        ),
        'example_in_old_shape': one("select id from facts where kind = 'example' and json_extract(payload, '$.text') is not null"),
        'translation_of_example': one(
            "select id from facts where kind = 'translation' and json_extract(payload, '$.of') = 'example'"
        ),
        'live_sentence_translation_without_subject': one(
            "select id from facts where kind = 'translation' and json_extract(payload, '$.of') = 'sentence' "
            "and status in ('pending', 'published') and not exists (select 1 from sentences where sentences.id = facts.subject_id)"
        ),
        'saying_without_sentence': one(
            "select list.id from facts as list, json_each(list.payload, '$.phrases') as item where list.kind = 'phrases' "
            "and json_extract(item.value, '$.type') = 'saying' "
            "and not exists (select 1 from sentences where sentences.id = json_extract(item.value, '$.sentence_id'))"
        ),
        'phrases_in_old_shape': one(
            "select list.id from facts as list, json_each(list.payload, '$.phrases') as item where list.kind = 'phrases' and item.type = 'text'"
        ),
        'published_phrase_item_without_entry': one(
            "select list.id from facts as list, json_each(list.payload, '$.phrases') as item where list.kind = 'phrases' "
            "and list.status = 'published' and json_extract(item.value, '$.type') <> 'saying' "
            "and not exists (select 1 from entries where entries.id = json_extract(item.value, '$.entry_id'))"
        ),
        'duplicate_live_content_keys': one(
            "select kind, content_key, subject_id, count(*) from facts where status in ('pending', 'published') "
            'group by kind, content_key, subject_id having count(*) > 1'
        ),
        'duplicate_slot_holders': one(
            "select kind, subject_id, slot, count(*) from facts where slot is not null "
            "and (status = 'published' or (status = 'pending' and supersedes_id is null)) group by kind, subject_id, slot having count(*) > 1"
        ),
        'foreign_keys': one('pragma foreign_key_check'),
    }


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], '--dry-run' in sys.argv[3:])
