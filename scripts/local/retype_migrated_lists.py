"""Type the phrases lists the sentences migration left untyped, then submit each as a correction.

Each list's items are asked as Jev choice questions (type, and sense for a compound or fixed phrase);
an item Jev answers below CONFIDENT goes to the review LLM with the review's type rules. The typed
list supersedes the migrated one through normal review; a list a curator published is superseded by
the curator. Items judged no lexical unit are left out; a list left with none is reported, not sent.

  python3 -I scripts/local/retype_migrated_lists.py <d1.sqlite> <work-dir> [--limit N] [--dry-run]

Run from the vocnet repo with the server up. Gateway settings come from dist/vocnet/.dev.vars, the
agent key from ../vocnet-producer/.env, the curator key from ~/.vocnet/keys/curator.key. Decisions
and outcomes are appended to <work-dir>/decided.jsonl and submitted.jsonl, so a rerun resumes.
"""
import json
import re
import sqlite3
import sys
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

CONFIDENT = 0.9
QUESTIONS_PER_CALL = 40
GROUP = ('idiom', 'fixed_phrase')  # review treats them as one group
ENTRY_TYPES = {
    'phrasal_verb': 'a phrasal verb: a verb with a particle that a learner\'s dictionary prints, even when transparent ("give up", "sit down")',
    'compound': 'a compound: a fixed compound naming one specific thing, or the everyday name of one kind of thing speakers learn as a whole ("bank account", "post office")',
    'idiom': 'an idiom: a phrase whose meaning is not the sum of its words ("a piece of cake", "bear fruit")',
    'fixed_phrase': 'a fixed phrase: a set prepositional or grammatical phrase, even when transparent ("at all", "in front of", "have to")',
    'saying': 'a complete sentence, even written in lower case: an established saying, proverb, or maxim ("actions speak louder than words")',
    'none': "not a lexical unit of this headword: a plain description built from the words' ordinary meanings (\"white rice\"), a coined combination no dictionary prints, or an idiom that belongs under its main content word rather than this grammar word",
}
SENTENCE_TYPES = {
    'saying': 'an established saying, proverb, or maxim a learner\'s dictionary prints ("Look before you leap.")',
    'none': 'a sentence anyone composes, or one no dictionary prints',
}
LLM_RULES = (
    "You type the phrases a learner's dictionary (Oxford Advanced Learner's, Longman, Cambridge) gives under a headword. "
    'Types: phrasal_verb, a verb with a particle the dictionaries print even when transparent ("give up"); compound, a fixed '
    'compound naming one thing or the everyday name of one kind of thing ("bank account"); idiom, meaning not the sum of its '
    'words; fixed_phrase, a set prepositional or grammatical phrase ("at all"); saying, a complete sentence that is an '
    'established proverb or maxim. A complete sentence is always a saying. Answer none for a plain description, a coined '
    'combination, a sentence no dictionary prints, or an idiom that belongs under its main content word rather than a grammar '
    'word. sense: the id of the headword sense a compound or fixed_phrase plainly belongs to, else null. '
    'Reply with JSON only: {"items": [{"n": <number>, "type": "<type or none>", "sense": "<sense id or null>"}]}.'
)


def env_file(path):
    out = {}
    for line in Path(path).read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            out[key.strip()] = value.strip().strip('"').strip("'")
    return out


GW = env_file('dist/vocnet/.dev.vars')
AGENT = env_file('../vocnet-producer/.env')
CURATOR_KEY = (Path.home() / '.vocnet/keys/curator.key').read_text().strip()


def post(url, body, key, timeout=600):
    req = urllib.request.Request(url, method='POST', data=json.dumps(body).encode(),
                                 headers={'authorization': f'Bearer {key}', 'content-type': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return response.status, json.loads(response.read() or b'null')
        except urllib.error.HTTPError as error:
            raw = error.read()
            if error.code < 500 or attempt == 3:
                try:
                    return error.code, json.loads(raw or b'null')
                except ValueError:
                    return error.code, {'raw': raw[:300].decode('utf-8', 'replace')}
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt == 3:
                return 0, {'raw': str(error)}


def gateway(path, body):
    status, data = post(GW['MODEL_BASE_URL'].rstrip('/') + '/' + path, body, GW['MODEL_API_KEY'], timeout=300)
    if status != 200:
        raise RuntimeError(f'{path} {status}: {str(data)[:300]}')
    return data


def is_sentence(text):
    return bool(re.match(r'^[A-Z"\'“‘]', text.strip())) and bool(re.search(r'\S\s+\S', text.strip()))


def load(db_path, limit):
    db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    db.execute('pragma busy_timeout = 30000')
    lemma = dict(db.execute('select id, lemma from entries'))
    rows = db.execute(
        "select id, subject_id, payload, author from facts where kind = 'phrases' and status = 'published' "
        "and json_extract(payload, '$.migrated') = 1 order by subject_id"
    ).fetchall()
    lists = []
    for fact_id, entry_id, payload, author in rows[: limit or None]:
        senses = db.execute(
            "select payload from facts where kind = 'senses' and subject_id = ? and status = 'published'", (entry_id,)
        ).fetchone()
        lists.append({
            'fact_id': fact_id, 'entry_id': entry_id, 'headword': lemma[entry_id], 'author': author,
            'senses': [{'id': s['id'], 'pos': s['pos'], 'gloss': s['gloss']} for s in json.loads(senses[0])['senses']] if senses else [],
            'items': [{'entry_id': i['entry_id'], 'text': lemma[i['entry_id']]} for i in json.loads(payload)['phrases']],
        })
    return lists


def jev(headword, questions):
    answers, keys = {}, list(questions)
    for start in range(0, len(keys), QUESTIONS_PER_CALL):
        chunk = {k: questions[k] for k in keys[start:start + QUESTIONS_PER_CALL]}
        data = gateway('v1/systemone', {'model': GW['JEV_MODEL'], 'state': {'headword': headword}, 'questions': chunk})
        answers.update({k: v['probabilities'] for k, v in data['answers'].items()})
    return answers


def best(probabilities, group=False):
    top = max(probabilities, key=probabilities.get)
    if group and all(k in probabilities for k in GROUP):
        pooled = sum(probabilities[k] for k in GROUP)
        if top in GROUP or pooled > probabilities[top]:
            return max(GROUP, key=lambda k: probabilities[k]), pooled
    return top, probabilities[top]


def llm_decide(lst, unsure):
    senses = '\n'.join(f'- {s["id"]}: ({s["pos"]}) {s["gloss"]}' for s in lst['senses'])
    lines = '\n'.join(f'{n}. "{lst["items"][n - 1]["text"]}"' for n in unsure)
    data = gateway('v1/chat/completions', {
        'model': GW['REVIEW_LLM_MODEL'], 'response_format': {'type': 'json_object'},
        'messages': [{'role': 'system', 'content': LLM_RULES},
                     {'role': 'user', 'content': f'Headword: "{lst["headword"]}"\nIts senses:\n{senses}\nPhrases:\n{lines}'}],
    })
    return {int(o['n']): o for o in json.loads(data['choices'][0]['message']['content'])['items']}


def classify(lst):
    sense_options = {f's{i + 1}': f'({s["pos"]}) {s["gloss"]}' for i, s in enumerate(lst['senses'])}
    sense_options['none'] = 'belongs to no single sense listed, as idioms and phrasal verbs usually do'
    questions = {}
    for n, item in enumerate(lst['items'], 1):
        sentence = is_sentence(item['text'])
        questions[f't{n}'] = {'type': 'choice', 'criteria': SENTENCE_TYPES if sentence else ENTRY_TYPES,
                              'instructions': f'What does a learner\'s dictionary print "{item["text"]}" as, under the headword "{lst["headword"]}"?'}
        if not sentence and len(sense_options) > 1:
            questions[f's{n}'] = {'type': 'choice', 'criteria': sense_options,
                                  'instructions': f'Which sense of the headword "{lst["headword"]}" does "{item["text"]}" belong to?'}
    answers = jev(lst['headword'], questions)
    decided, unsure = {}, []
    for n in range(1, len(lst['items']) + 1):
        pick, confidence = best(answers[f't{n}'], group=True)
        sense = None
        if f's{n}' in answers:
            spick, sconf = best(answers[f's{n}'])
            if spick != 'none' and sconf >= CONFIDENT:
                sense = lst['senses'][int(spick[1:]) - 1]['id']
        if confidence >= CONFIDENT:
            decided[n] = {'type': pick, 'sense': sense, 'by': 'jev'}
        else:
            unsure.append(n)
    if unsure:
        sense_ids = {s['id'] for s in lst['senses']}
        for n, o in llm_decide(lst, unsure).items():
            if n in unsure:
                decided[n] = {'type': o['type'], 'sense': o.get('sense') if o.get('sense') in sense_ids else None, 'by': 'llm'}
    phrases, dropped = [], []
    for n, item in enumerate(lst['items'], 1):
        d = decided.get(n) or {'type': 'none', 'by': 'missing'}
        if d['type'] == 'saying':
            text = item['text'].strip()
            text = text[0].upper() + text[1:]
            phrases.append({'type': 'saying', 'text': text if text[-1] in '.!?' else text + '.'})
        elif d['type'] in ENTRY_TYPES and d['type'] not in ('none', 'saying') and not is_sentence(item['text']):
            entry = {'type': d['type'], 'entry_id': item['entry_id']}
            if d.get('sense') and d['type'] in ('compound', 'fixed_phrase'):
                entry['sense_id'] = d['sense']
            phrases.append(entry)
        else:
            dropped.append({'text': item['text'], **d})
    return {'fact_id': lst['fact_id'], 'entry_id': lst['entry_id'], 'headword': lst['headword'],
            'author': lst['author'], 'phrases': phrases, 'dropped': dropped, 'unsure': len(unsure)}


def submit(decision):
    if not decision['phrases']:
        return {'status': 'empty'}
    url = AGENT['VOCNET_API_URL'].rstrip('/') + '/manage/v1/facts'
    body = {'kind': 'phrases', 'subject_id': decision['entry_id'], 'supersedes_id': decision['fact_id'],
            'payload': {'phrases': decision['phrases']}}
    status, response = post(url, body, AGENT['VOCNET_AGENT_KEY'])
    if status == 403:
        body['curation'] = {'reason': 'Typed the list the sentences migration left untyped (Jev choice questions, uncertain items by the review LLM); a curator list, so the curator supersedes it.'}
        status, response = post(url, body, CURATOR_KEY)
        return {'status': status, 'as': 'curator', 'error': None if status in (200, 201) else response}
    return {'status': status, 'as': 'agent', 'error': None if status in (200, 201) else response}


def main(db_path, work_dir, limit, dry_run):
    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    decided_path, submitted_path = work / 'decided.jsonl', work / 'submitted.jsonl'
    decided = {json.loads(l)['fact_id']: json.loads(l) for l in open(decided_path)} if decided_path.exists() else {}
    sent = {r['fact_id'] for r in map(json.loads, open(submitted_path)) if r['status'] not in (0, 500, 502, 503)} if submitted_path.exists() else set()
    lock = threading.Lock()

    def run(lst):
        try:
            decision = decided.get(lst['fact_id']) or classify(lst)
        except Exception as error:  # retried on the next run
            print(f'{lst["headword"]}: classify failed: {error}', flush=True)
            return
        with lock:
            if lst['fact_id'] not in decided:
                decided[lst['fact_id']] = decision
                with open(decided_path, 'a') as f:
                    f.write(json.dumps(decision, ensure_ascii=False) + '\n')
        if dry_run or lst['fact_id'] in sent:
            return
        outcome = submit(decision)
        with lock, open(submitted_path, 'a') as f:
            f.write(json.dumps({'fact_id': lst['fact_id'], 'headword': lst['headword'], **outcome}, ensure_ascii=False) + '\n')

    todo = load(db_path, limit)
    print(f'{len(todo)} migrated lists', flush=True)
    with ThreadPoolExecutor(4) as pool:
        list(pool.map(run, todo))


if __name__ == '__main__':
    args = sys.argv[1:]
    limit = int(args[args.index('--limit') + 1]) if '--limit' in args else 0
    main(args[0], args[1], limit, '--dry-run' in args)
