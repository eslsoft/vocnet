"""Settle the migrated phrases lists no typed correction got through, as the curator.

Review rejected these lists by over-applying the filing rule: a phrase is filed under its main
content word and never under a grammar word, but nothing keeps a phrase from a content-word headword
it contains. So each item is judged on its own (Jev choice, uncertain items by the review LLM):
  - under a grammar-word headword (every sense a preposition, conjunction, pronoun, determiner,
    article, or auxiliary) it stays only when it is built on that word itself ("a lot of");
  - under a content-word headword it stays when it is a lexical unit of any type.
A list with items left is published typed by the curator; a list with none is retracted and the
phrase entries no other published list names are retired.

  python3 -I scripts/local/settle_untypable_lists.py <d1.sqlite> <work-dir> [--dry-run]
"""
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import retype_migrated_lists as rt  # noqa: E402

GRAMMAR_POS = {'preposition', 'conjunction', 'pronoun', 'determiner', 'article', 'auxiliary', 'modal'}
TYPES = {k: v for k, v in rt.ENTRY_TYPES.items() if k != 'none'} | {
    'saying': rt.ENTRY_TYPES.get('saying', 'a complete sentence that is an established saying or proverb'),
    'none': 'not a lexical unit: a plain description built from the words\' ordinary meanings, a free combination, or an ordinary sentence no dictionary prints',
}
BUILT_ON = {
    'yes': 'a phrase built on the grammar word itself, as "a lot of" is built on "a" or "after all" on "after"',
    'no': 'a phrase of another word that merely contains the grammar word, as "happen upon" is a phrase of "happen"',
}


def decide(lst, grammar):
    questions = {}
    for n, item in enumerate(lst['items'], 1):
        questions[f't{n}'] = {'type': 'choice', 'criteria': TYPES,
                              'instructions': f'What kind of English lexical unit is "{item["text"]}"?'}
        if grammar:
            questions[f'b{n}'] = {'type': 'choice', 'criteria': BUILT_ON,
                                  'instructions': f'Is "{item["text"]}" built on the grammar word "{lst["headword"]}" itself?'}
    answers = rt.jev(lst['headword'], questions)
    kept, dropped = [], []
    for n, item in enumerate(lst['items'], 1):
        kind, confidence = rt.best(answers[f't{n}'], group=True)
        if confidence < 0.6:
            kind = 'none'
        if grammar and rt.best(answers[f'b{n}'])[0] != 'yes':
            dropped.append(f'{item["text"]} (belongs to another word)')
            continue
        if kind == 'none':
            dropped.append(f'{item["text"]} (no lexical unit)')
        elif kind == 'saying':
            text = item['text'].strip()
            text = text[0].upper() + text[1:]
            kept.append({'type': 'saying', 'text': text if text[-1] in '.!?' else text + '.'})
        else:
            kept.append({'type': kind, 'entry_id': item['entry_id']})
    return kept, dropped


def main(db_path, work_dir, dry_run):
    db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    db.execute('pragma busy_timeout = 30000')
    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    base = rt.AGENT['VOCNET_API_URL'].rstrip('/') + '/manage/v1'
    lists = [l for l in rt.load(db_path, 0)]
    log = open(work / 'settled.jsonl', 'a')
    retire = set()
    tally = {}
    for lst in lists:
        pos = {s['pos'] for s in lst['senses']}
        grammar = bool(pos) and pos <= GRAMMAR_POS
        kept, dropped = decide(lst, grammar)
        record = {'headword': lst['headword'], 'grammar_word': grammar, 'kept': kept, 'dropped': dropped}
        if dry_run:
            outcome = 'dry-run'
        elif kept:
            body = {'kind': 'phrases', 'subject_id': lst['entry_id'], 'supersedes_id': lst['fact_id'],
                    'payload': {'phrases': kept},
                    'curation': {'reason': 'Typed the migrated list; review had refused phrases filed under a content word they contain, which the filing rule allows. Dropped: ' + '; '.join(dropped)[:700]}}
            status, _ = rt.post(f'{base}/facts', body, rt.CURATOR_KEY)
            outcome = f'published {status}'
        else:
            key = rt.AGENT['VOCNET_AGENT_KEY'] if lst['author'].startswith('agent:1111') else rt.CURATOR_KEY
            status, _ = rt.post(f'{base}/facts/{lst["fact_id"]}/retract', {}, key)
            if status != 200 and key != rt.CURATOR_KEY:
                status, _ = rt.post(f'{base}/facts/{lst["fact_id"]}/retract', {}, rt.CURATOR_KEY)
            outcome = f'retracted {status}'
            retire |= {item['entry_id'] for item in lst['items']}
        tally[outcome.split()[0] + (' grammar' if grammar else '')] = tally.get(outcome.split()[0] + (' grammar' if grammar else ''), 0) + 1
        log.write(json.dumps({**record, 'outcome': outcome}, ensure_ascii=False) + '\n')
        print(f'{lst["headword"]:<14} {"grammar" if grammar else "content":<8} {outcome:<14} kept {len(kept)} dropped {len(dropped)}', flush=True)
    retired = {}
    for entry_id in retire:
        status, response = rt.post(f'{base}/entries/{entry_id}/retire', {}, rt.CURATOR_KEY)
        key = 'retired' if status == 200 and (response or {}).get('retired') else ('still named elsewhere' if status == 409 else f'{status}')
        retired[key] = retired.get(key, 0) + 1
    print(json.dumps({'lists': tally, 'entries': retired}, ensure_ascii=False))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], '--dry-run' in sys.argv[3:])
