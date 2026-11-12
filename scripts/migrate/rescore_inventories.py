"""Re-scores the sense inventories the redesign migration carried over with an LLM-only review.

The migration built each inventory from senses and sense lists the old chain reviewed, and gave it
the sense list's LLM review, so every such inventory has the LLM-alone credibility (0.7) and audits
cannot rank by it. Replaying today's chain fixes that: Jev judges each gloss, and its pass settles the
inventory (reviewer jev); otherwise the LLM verdict it already has stands (reviewer jev+llm).

    python3 -I scripts/migrate/rescore_inventories.py export <d1.sqlite> <work-dir>
    node <bundle of rescore-inventories.ts> <work-dir>          # asks Jev, writes scored.jsonl
    python3 -I scripts/migrate/rescore_inventories.py apply <d1.sqlite> <work-dir>
    python3 -I scripts/migrate/rescore_inventories.py audit <d1.sqlite> <work-dir>

`audit` opens an audit ticket on each re-scored inventory Jev scored below 0.5 on some gloss while
the LLM passed it: the two reviewers disagree outright, so a curator checks it. Stop the server first.

`export` reads a copy (or the live file read-only). `apply` writes the live file: stop the producer
workers and the server first. It changes only facts still published with the LLM review it read,
and marks their entries stale so the rescore recomputes their credibility.
"""

import json
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

SELECT = """
select f.id, f.subject_id, f.payload, f.review, e.lemma
from facts f join entries e on e.id = f.subject_id
where f.kind = 'senses' and f.status = 'published' and json_extract(f.review, '$.reviewer') = 'llm'
order by e.lemma
"""

LIVE_CASE_VARIANTS = """
select other.lemma from entries other join worklist w on w.entry_id = other.id
where lower(other.lemma) = lower(?) and other.id <> ? and w.live = 1 order by other.lemma
"""


def export(db_path: str, work: Path) -> None:
    db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    work.mkdir(parents=True, exist_ok=True)
    count = 0
    with (work / 'inventories.jsonl').open('w') as out:
        for fact_id, entry_id, payload, review, lemma in db.execute(SELECT).fetchall():
            variants = [row[0] for row in db.execute(LIVE_CASE_VARIANTS, (lemma, entry_id))]
            out.write(
                json.dumps(
                    {
                        'factId': fact_id,
                        'lemma': lemma,
                        'caseVariants': variants,
                        'payload': json.loads(payload),
                        'review': json.loads(review),
                    }
                )
                + '\n'
            )
            count += 1
    print(f'exported {count} inventories to {work / "inventories.jsonl"}')


def apply(db_path: str, work: Path) -> None:
    scored = [json.loads(line) for line in (work / 'scored.jsonl').open()]
    db = sqlite3.connect(db_path, timeout=60)
    with db:
        changed = 0
        for row in scored:
            # Only a fact that still holds the LLM review the score replays: a curator or a correction
            # that touched it since wins.
            cursor = db.execute(
                "update facts set review = ? where id = ? and kind = 'senses' and status = 'published' "
                "and json_extract(review, '$.reviewer') = 'llm' and json_extract(review, '$.reviewed_at') = ?",
                (json.dumps(row['review']), row['factId'], row['previousReviewedAt']),
            )
            changed += cursor.rowcount
        db.execute(
            'update worklist set revision = revision + 1 where entry_id in '
            "(select subject_id from facts where kind = 'senses' and status = 'published' "
            "and json_extract(review, '$.detail.rescored') = 1)"
        )
    paths = dict(
        db.execute(
            "select json_extract(review, '$.reviewer'), count(*) from facts "
            "where kind = 'senses' and status = 'published' group by 1"
        ).fetchall()
    )
    print(f'updated {changed} of {len(scored)} inventories; published inventories by reviewer: {paths}')


# Below this Jev reads a gloss as wrong (review-chain DECISION_FAIL_BELOW).
JEV_FAIL_BELOW = 0.5


def audit(db_path: str, work: Path) -> None:
    exported = {row['factId']: row for row in map(json.loads, (work / 'inventories.jsonl').open())}
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
    tickets = []
    for row in map(json.loads, (work / 'scored.jsonl').open()):
        review = row['review']
        if review['reviewer'] != 'jev+llm':
            continue
        jev_part, _, llm_reason = review['reason'].partition(' | ')
        scores = {key: float(value) for key, value in re.findall(r'(sense_\d+)=([\d.]+)', jev_part)}
        failed = {key: score for key, score in scores.items() if score < JEV_FAIL_BELOW}
        if not failed:
            continue
        senses = exported[row['factId']]['payload']['senses']
        listed = '; '.join(
            f"{key}={score:g} ({senses[int(key.split('_')[1]) - 1]['pos']}: {senses[int(key.split('_')[1]) - 1]['gloss']})"
            for key, score in sorted(failed.items(), key=lambda item: item[1])
        )
        message = f'Jev scored below {JEV_FAIL_BELOW} what the LLM passed: {listed}. LLM: {llm_reason}'
        tickets.append((str(uuid.uuid4()), row['factId'], message[:2000], now, now))
    db = sqlite3.connect(db_path, timeout=60)
    with db:
        before = db.total_changes
        db.executemany(
            "insert into tickets (id, type, target_type, target, message, status, resolution_note, "
            "resolution_fact_ids, revision, created_at, updated_at) "
            "select ?, 'audit', 'fact', ?, ?, 'open', null, '[]', 0, ?, ? "
            "on conflict do nothing",
            tickets,
        )
        opened = db.total_changes - before
    print(f'{len(tickets)} inventories disagree; opened {opened} audit tickets')


if __name__ == '__main__':
    command, db_path, work_dir = sys.argv[1:4]
    {'export': export, 'apply': apply, 'audit': audit}[command](db_path, Path(work_dir))
