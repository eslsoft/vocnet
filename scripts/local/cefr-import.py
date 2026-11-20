"""Imports the levels of a set of CEFR word lists as curated cefr facts (docs/design.md, CEFR levels).
The curator key is read from ~/.vocnet/keys/curator.key.

  python3 -I scripts/local/cefr-import.py <lists dir> <source name> [--admit] [--dry-run]

<lists dir> holds CEFR-A1.json ... CEFR-C2.json, each a JSON array of words. A word takes the lowest
level a list gives it. Each word that has an entry the reference lists do not level gets a curated
cefr fact, its reason naming <source name> and the list: a published estimate is corrected by it, and
a word the reference lists level, or whose level is curated or still pending, is skipped. With --admit, a lower-case single word that has no entry
is admitted first, as a headword of batch 0, so it is produced first.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

BASE = os.environ.get('VOCNET_URL', 'http://localhost:5173') + '/manage/v1'
KEY = (Path.home() / '.vocnet/keys/curator.key').read_text().strip()
LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
ADMIT_BATCH = 0


def call(method, path, body=None):
    request = urllib.request.Request(
        BASE + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'authorization': f'Bearer {KEY}', 'content-type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, json.loads(response.read() or b'null')
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b'null')


def admissible(word):
    """A lower-case single word: names, abbreviations, and phrases are left to their own imports."""
    return word.islower() and word.replace('-', '').isalpha()


def main(directory, source, admit, dry_run):
    levels = {}
    for level in LEVELS:
        for word in json.loads((Path(directory) / f'CEFR-{level}.json').read_text()):
            word = ' '.join(word.split())
            if word and (word not in levels or LEVELS.index(level) < LEVELS.index(levels[word])):
                levels[word] = level
    counts = Counter()
    for word, level in sorted(levels.items(), key=lambda item: (LEVELS.index(item[1]), item[0])):
        status, entry = call('GET', f'/entries/{urllib.parse.quote(word, safe="")}')
        if status == 404:
            if not (admit and admissible(word)):
                counts['no entry, skipped'] += 1
                continue
            if dry_run:
                counts[f'would admit and level {level}'] += 1
                continue
            status, created = call('POST', '/entries', {'lemma': word, 'batch': ADMIT_BATCH})
            if status not in (200, 201):
                counts[f'admit failed {status}'] += 1
                print(f'{word}: admit {status} {created}', file=sys.stderr)
                continue
            counts['admitted'] += 1
            status, entry = call('GET', f'/entries/{urllib.parse.quote(word, safe="")}')
        if status != 200:
            counts[f'read failed {status}'] += 1
            print(f'{word}: read {status} {entry}', file=sys.stderr)
            continue
        if entry['cefr']:
            counts['leveled by the reference lists'] += 1
            continue
        live = [fact for fact in entry['facts'] if fact['kind'] == 'cefr' and fact['status'] in ('pending', 'published')]
        estimate = next((fact for fact in live if fact['status'] == 'published' and fact['review'] and fact['review']['reviewer'] != 'curator'), None)
        if live and not estimate:
            counts['has a curated or pending level'] += 1
            continue
        if estimate and estimate['payload']['level'] == level:
            counts['estimate already agrees'] += 1
            continue
        verb = 'correct' if estimate else 'level'
        if dry_run:
            counts[f'would {verb} {level}'] += 1
            continue
        status, body = call(
            'POST',
            '/facts',
            {
                'kind': 'cefr',
                'subject_id': entry['entry']['id'],
                'payload': {'level': level},
                'curation': {'reason': f'{source}: listed at {level} (CEFR-{level}).'},
                **({'supersedes_id': estimate['id']} if estimate else {}),
            },
        )
        if status in (200, 201):
            counts[f'{verb}ed {level}'.replace('levelled', 'leveled')] += 1
        else:
            counts[f'submit failed {status}'] += 1
            print(f'{word}: submit {status} {body}', file=sys.stderr)
    for label, count in sorted(counts.items()):
        print(f'{label}: {count}')


if __name__ == '__main__':
    args = [arg for arg in sys.argv[1:] if not arg.startswith('--')]
    if len(args) != 2:
        sys.exit(__doc__)
    main(args[0], args[1], '--admit' in sys.argv, '--dry-run' in sys.argv)
