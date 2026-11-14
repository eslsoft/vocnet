"""Retract the published collocations that are phrases: an idiom, fixed phrase, or phrasal verb whose
meaning is not plain from its words or whose form is frozen (the collocation rule since beb8bb9).

Each collocation is a Jev choice question; an answer of 'phrase' at CONFIDENT or above is retracted
by its author (else the curator). A phrase with no live entry is listed in <work-dir>/missing.jsonl
for the headword's phrases list. Every decision is appended to <work-dir>/judged.jsonl, so a rerun
resumes.

  python3 -I scripts/local/clean_collocations.py <d1.sqlite> <work-dir> [--dry-run] [--limit N]
"""
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import retype_migrated_lists as rt  # noqa: E402

CONFIDENT = 0.8
CRITERIA = {
    'collocation': 'a collocation: its meaning is plain from its words, only the choice of words is conventional ("heavy rain", "make a decision", "by air", "over the phone")',
    'phrase': 'a phrase: an idiom, fixed phrase, or phrasal verb whose meaning is not plain from its words or whose form is frozen ("in vain", "a means to an end", "in the long run", "kick the bucket")',
}


def main(db_path, work_dir, dry_run, limit):
    db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    db.execute('pragma busy_timeout = 30000')
    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    judged_path = work / 'judged.jsonl'
    judged = {json.loads(l)['id'] for l in open(judged_path)} if judged_path.exists() else set()
    rows = db.execute(
        """select c.id, json_extract(c.payload, '$.text'), json_extract(c.payload, '$.pattern'), c.author, e.lemma
           from facts c join senses s on s.id = c.subject_id join entries e on e.id = s.entry_id
           where c.kind = 'collocation' and c.status = 'published' order by c.id"""
    ).fetchall()
    rows = [r for r in rows if r[0] not in judged][: limit or None]
    live = {lemma.lower() for (lemma,) in db.execute(
        "select e.lemma from entries e join worklist w on w.entry_id = e.id where w.live = 1 and e.lemma like '% %'")}
    base = rt.AGENT['VOCNET_API_URL'].rstrip('/') + '/manage/v1/facts'
    out, missing = open(judged_path, 'a'), open(work / 'missing.jsonl', 'a')
    tally = {}
    for start in range(0, len(rows), 40):
        chunk = rows[start:start + 40]
        questions = {f'q{i}': {'type': 'choice', 'criteria': CRITERIA,
                               'instructions': f'Is "{text}" (with the word "{lemma}") a collocation or a phrase?'}
                     for i, (_, text, _, _, lemma) in enumerate(chunk)}
        answers = rt.jev('collocations', questions)
        for i, (fid, text, pattern, author, lemma) in enumerate(chunk):
            pick, confidence = rt.best(answers[f'q{i}'])
            verdict = 'phrase' if pick == 'phrase' and confidence >= CONFIDENT else 'keep'
            outcome = None
            if verdict == 'phrase' and not dry_run:
                key = rt.AGENT['VOCNET_AGENT_KEY'] if author.startswith('agent:1111') else rt.CURATOR_KEY
                status, _ = rt.post(f'{base}/{fid}/retract', {}, key)
                if status != 200 and key != rt.CURATOR_KEY:
                    status, _ = rt.post(f'{base}/{fid}/retract', {}, rt.CURATOR_KEY)
                outcome = status
                if text.lower() not in live:
                    missing.write(json.dumps({'headword': lemma, 'text': text}, ensure_ascii=False) + '\n')
            key = f'{verdict}{" (phrase entry exists)" if verdict == "phrase" and text.lower() in live else ""}'
            tally[key] = tally.get(key, 0) + 1
            out.write(json.dumps({'id': fid, 'text': text, 'pattern': pattern, 'headword': lemma, 'verdict': verdict,
                                  'confidence': round(confidence, 2), 'retract': outcome}, ensure_ascii=False) + '\n')
        if start % 4000 == 0:
            print(start, tally, flush=True)
    print(json.dumps(tally, ensure_ascii=False))


if __name__ == '__main__':
    args = sys.argv[1:]
    main(args[0], args[1], '--dry-run' in args, int(args[args.index('--limit') + 1]) if '--limit' in args else 0)
