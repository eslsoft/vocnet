"""Add the phrases retracted from collocations (clean_collocations.py's missing.jsonl) to their
headwords' phrases lists, as the curator.

Each phrase is typed by a Jev choice question; a complete sentence is a saying. A headword's live list
is superseded by itself plus its new phrases; a headword with none gets a new list. A phrase that is
a multiword headword's or is already listed is skipped.

  python3 -I scripts/local/add_phrases_from_collocations.py <d1.sqlite> <missing.jsonl> <work-dir> [--dry-run]
"""
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import retype_migrated_lists as rt  # noqa: E402

TYPES = {k: v for k, v in rt.ENTRY_TYPES.items() if k != 'none'}


def main(db_path, missing_path, work_dir, dry_run):
    db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    db.execute('pragma busy_timeout = 30000')
    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    wanted = defaultdict(dict)
    for line in open(missing_path):
        row = json.loads(line)
        if ' ' in row['headword'].strip():
            continue  # a list on a multiword entry is refused
        wanted[row['headword']].setdefault(row['text'].strip().lower(), row['text'].strip())
    texts = [(head, text) for head, items in wanted.items() for text in items.values()]
    types = {}
    for start in range(0, len(texts), 40):
        chunk = texts[start:start + 40]
        questions = {f'q{i}': {'type': 'choice', 'criteria': TYPES,
                               'instructions': f'What kind of phrase of the headword "{head}" is "{text}"?'}
                     for i, (head, text) in enumerate(chunk)}
        answers = rt.jev('phrases', questions)
        for i, (head, text) in enumerate(chunk):
            types[(head, text)] = rt.best(answers[f'q{i}'], group=True)[0]
    base = rt.AGENT['VOCNET_API_URL'].rstrip('/') + '/manage/v1/facts'
    log = open(work / 'added.jsonl', 'a')
    tally = defaultdict(int)
    for head, items in wanted.items():
        found = db.execute('select id from entries where lemma = ?', (head,)).fetchone()
        if not found:
            tally['no headword'] += 1
            continue
        head_id = found[0]
        live = db.execute("select id, payload from facts where kind = 'phrases' and subject_id = ? and status = 'published'", (head_id,)).fetchone()
        current = [{k: v for k, v in p.items() if k in ('type', 'entry_id', 'sentence_id', 'sense_id')}
                   for p in (json.loads(live[1])['phrases'] if live else [])]
        listed = set()
        for p in current:
            row = db.execute('select lemma from entries where id = ?', (p.get('entry_id'),)).fetchone() if 'entry_id' in p else \
                db.execute('select text from sentences where id = ?', (p.get('sentence_id'),)).fetchone()
            if row:
                listed.add(row[0].strip().lower().rstrip('.!?'))
        added = []
        for key, text in items.items():
            if key.rstrip('.!?') in listed:
                continue
            kind = types[(head, text)]
            if not rt.contains_word(text, head):
                continue  # the server lists only a phrase containing the headword as written
            if rt.is_sentence(text) or kind == 'saying':
                t = text[0].upper() + text[1:]
                added.append({'type': 'saying', 'text': t if t[-1] in '.!?' else t + '.'})
            else:
                added.append({'type': kind, 'text': text})
        if not added:
            tally['already listed'] += 1
            continue
        body = {'kind': 'phrases', 'subject_id': head_id, 'payload': {'phrases': current + added},
                'curation': {'reason': 'Phrases that were recorded as collocations: an idiom, fixed phrase, or phrasal verb belongs in the phrases list.'}}
        if live:
            body['supersedes_id'] = live[0]
        status, response = (0, None) if dry_run else rt.post(base, body, rt.CURATOR_KEY)
        tally[f'{"dry-run" if dry_run else status}'] += 1
        tally['phrases added'] += len(added)
        log.write(json.dumps({'headword': head, 'added': added, 'status': status,
                              'error': None if status in (0, 200, 201) else response}, ensure_ascii=False) + '\n')
    print(json.dumps(tally, ensure_ascii=False))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3], '--dry-run' in sys.argv[4:])
