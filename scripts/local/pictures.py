"""Producer of sense pictures for the local vocnet server (docs/design.md, Pictures). The key is read from ~/.vocnet/keys/curator.key.

  python3 -I scripts/local/pictures.py jobs <d1.sqlite> <jobs.jsonl> [--topics]
      one job per public entry, most frequent first: its first common sense and that sense's first example
      (--topics: only entries with a sense tagged with a topic)
  python3 -I scripts/local/pictures.py jobs <d1.sqlite> <jobs.jsonl> --topic-senses
      one job per sense tagged with a topic that has no image fact yet
  bash scripts/local/picture-gen.sh <job json> <dir> [example]
      draws a job's sense, or its example, through the model gateway into <dir>/<sense id>[.example].webp
  python3 -I scripts/local/pictures.py submit <jobs.jsonl> <dir> <ledger.jsonl> [<limit>] [--curated]
      stores each drawn picture not yet submitted and submits its image fact, at most <limit> of them, so a
      run never queues more reviews than the producers' facts can wait behind; the ledger records each submission;
      with --curated, each fact is published at once with a curator review instead of the reviewer chain
  python3 -I scripts/local/pictures.py status <ledger.jsonl> [<jobs.jsonl> <retry.jsonl>]
      counts the submitted facts by status; with the jobs, writes to <retry.jsonl> the jobs whose picture of the
      sense was rejected and that have an example, for picture-gen.sh with "example" and a second submit
"""

import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

BASE = os.environ.get('VOCNET_URL', 'http://localhost:5173')
KEY = (Path.home() / '.vocnet/keys/curator.key').read_text().strip()


def call(method, path, body=None, content_type='application/json'):
    data = body if isinstance(body, bytes) or body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        BASE + path,
        method=method,
        data=data,
        headers={'authorization': f'Bearer {KEY}', 'content-type': content_type},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, json.loads(response.read() or b'null')
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b'null')


def read_jsonl(path):
    if not Path(path).exists():
        return []
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]


def topic_sense_jobs(db_path, out_path):
    """One job per sense tagged with a topic that has no image fact yet, most frequent entry first."""
    db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    tagged = {row[0] for row in db.execute('SELECT DISTINCT sense_id FROM public_sense_topics')}
    tried = {row[0] for row in db.execute("SELECT DISTINCT subject_id FROM facts WHERE kind = 'image'")}
    rows = db.execute(
        """SELECT p.entry_id, json_extract(p.document, '$.lemma'), w.zipf, json_extract(p.document, '$.meanings')
            FROM public_entries p LEFT JOIN worklist w ON w.entry_id = p.entry_id
            WHERE p.entry_id IN (SELECT entry_id FROM public_sense_topics)
            ORDER BY coalesce(w.zipf, -1) DESC, p.entry_id"""
    )
    written = 0
    with open(out_path, 'w') as out:
        for entry_id, lemma, zipf, meanings in rows:
            for meaning in json.loads(meanings):
                for sense in meaning['senses']:
                    if sense['id'] not in tagged or sense['id'] in tried:
                        continue
                    example = sense['examples'][0] if sense['examples'] else None
                    job = {
                        'entry_id': entry_id,
                        'lemma': lemma,
                        'zipf': zipf,
                        'labels': sense.get('labels') or [],
                        'sense': {
                            'id': sense['id'],
                            'pos': meaning['pos'],
                            'gloss': sense['gloss'],
                            'example': example and {'sentence_id': example['sentence_id'], 'text': example['text']},
                        },
                    }
                    out.write(json.dumps(job, ensure_ascii=False) + '\n')
                    written += 1
    print(f'{written} jobs')


def jobs(db_path, out_path, topics_only):
    db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    where = 'WHERE p.entry_id IN (SELECT entry_id FROM public_sense_topics)' if topics_only else ''
    rows = db.execute(
        f"""SELECT p.entry_id, json_extract(p.document, '$.lemma'), w.zipf, json_extract(p.document, '$.meanings')
            FROM public_entries p LEFT JOIN worklist w ON w.entry_id = p.entry_id {where}
            ORDER BY coalesce(w.zipf, -1) DESC, p.entry_id"""
    )
    written = 0
    with open(out_path, 'w') as out:
        for entry_id, lemma, zipf, meanings in rows:
            senses = [
                (meaning['pos'], sense)
                for meaning in json.loads(meanings)
                for sense in meaning['senses']
                if not sense['rare']
            ]
            if not senses:
                continue
            pos, sense = senses[0]
            example = sense['examples'][0] if sense['examples'] else None
            job = {
                'entry_id': entry_id,
                'lemma': lemma,
                'zipf': zipf,
                'sense': {
                    'id': sense['id'],
                    'pos': pos,
                    'gloss': sense['gloss'],
                    'example': example and {'sentence_id': example['sentence_id'], 'text': example['text']},
                },
            }
            out.write(json.dumps(job, ensure_ascii=False) + '\n')
            written += 1
    print(f'{written} jobs')


def submit(jobs_path, directory, ledger_path, limit=None, curated=False):
    submitted = {(row['sense_id'], row['mode']) for row in read_jsonl(ledger_path)}
    budget = int(limit) if limit else None
    counts = Counter()
    with open(ledger_path, 'a') as ledger:
        for job in read_jsonl(jobs_path):
            sense = job['sense']
            for mode, suffix in (('sense', ''), ('example', '.example')):
                picture = Path(directory) / f'{sense["id"]}{suffix}.webp'
                if (sense['id'], mode) in submitted or not picture.exists():
                    continue
                if budget is not None and sum(counts[m] for m in ('sense', 'example')) >= budget:
                    print(dict(counts))
                    return
                status, stored = call('POST', '/manage/v1/media', picture.read_bytes(), 'image/webp')
                if status != 200:
                    counts[f'upload {status}'] += 1
                    print(f'{job["lemma"]}: upload {status} {stored}', file=sys.stderr)
                    continue
                payload = {'image_id': stored['id']}
                if mode == 'example':
                    payload['sentence_id'] = sense['example']['sentence_id']
                fact = {'kind': 'image', 'subject_id': sense['id'], 'payload': payload}
                if curated:
                    fact['curation'] = {'reason': 'The owner publishes the drawn pictures without review.'}
                status, body = call('POST', '/manage/v1/facts', fact)
                if status not in (200, 201):
                    counts[f'submit {status}'] += 1
                    print(f'{job["lemma"]}: submit {status} {body}', file=sys.stderr)
                    continue
                row = {'lemma': job['lemma'], 'sense_id': sense['id'], 'mode': mode, 'fact_id': body['fact']['id']}
                ledger.write(json.dumps(row, ensure_ascii=False) + '\n')
                ledger.flush()
                counts[mode] += 1
    print(dict(counts))


def status(ledger_path, jobs_path=None, retry_path=None):
    rows = read_jsonl(ledger_path)
    counts = Counter()
    rejected = set()
    for row in rows:
        code, fact = call('GET', f'/manage/v1/facts/{row["fact_id"]}')
        state = fact['status'] if code == 200 else f'http {code}'
        counts[(row['mode'], state)] += 1
        if row['mode'] == 'sense' and state == 'rejected':
            rejected.add(row['sense_id'])
    for (mode, state), count in sorted(counts.items()):
        print(f'{mode:8} {state:10} {count}')
    if retry_path:
        tried = {row['sense_id'] for row in rows if row['mode'] == 'example'}
        retry = [
            job
            for job in read_jsonl(jobs_path)
            if job['sense']['id'] in rejected and job['sense']['id'] not in tried and job['sense']['example']
        ]
        Path(retry_path).write_text(''.join(json.dumps(job, ensure_ascii=False) + '\n' for job in retry))
        print(f'{len(retry)} jobs to draw from their example')


if __name__ == '__main__':
    command, *args = sys.argv[1:]
    if command == 'jobs' and '--topic-senses' in args[2:]:
        topic_sense_jobs(args[0], args[1])
    elif command == 'jobs':
        jobs(args[0], args[1], '--topics' in args[2:])
    elif command == 'submit':
        submit(*[arg for arg in args if arg != '--curated'], curated='--curated' in args)
    elif command == 'status':
        status(*args)
    else:
        sys.exit(__doc__)
