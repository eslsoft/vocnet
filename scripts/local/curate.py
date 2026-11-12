"""Curator helper for the local vocnet server. The curator key is read from ~/.vocnet/keys/curator.key.

  python3 -I scripts/local/curate.py tickets <stuck_work|audit> [limit] [cursor]   list open tickets (id, lemma, message)
  python3 -I scripts/local/curate.py show <ticket-id>                                the ticket, its entry's inventory, the slot's recent facts
  python3 -I scripts/local/curate.py entry <lemma>                                   the entry's managed view: inventory and live facts
  python3 -I scripts/local/curate.py submit <payload.json> "<reason>"                submit a curated fact ({kind, subject_id, payload, supersedes_id?})
  python3 -I scripts/local/curate.py resolve <ticket-id> "<note>" [fact-id ...]      close a ticket as fixed by these facts
  python3 -I scripts/local/curate.py dismiss <ticket-id> "<note>"                    close a ticket as needing no change
  python3 -I scripts/local/curate.py settle <entry-id> <work-type> <subject-id> "<note>"   record that nothing can fill a slot
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = os.environ.get('VOCNET_URL', 'http://localhost:5173') + '/manage/v1'
KEY = (Path.home() / '.vocnet/keys/curator.key').read_text().strip()


def call(method, path, body=None):
    request = urllib.request.Request(
        BASE + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'authorization': f'Bearer {KEY}', 'content-type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b'null')


def need(status, body, ok=(200, 201, 204)):
    if status not in ok:
        sys.exit(f'HTTP {status}: {json.dumps(body, ensure_ascii=False)}')
    return body


def inventory_lines(view):
    published = [f for f in view['facts'] if f['kind'] == 'senses' and f['status'] in ('published', 'pending')]
    for fact in published:
        print(f"inventory {fact['id']} [{fact['status']}] reviewer={(fact.get('review') or {}).get('reviewer')}")
        for at, sense in enumerate(fact['payload']['senses'], 1):
            labels = ','.join(x for x in (sense.get('register'), sense.get('region')) if x)
            print(f"  {at:2d}. {sense['id']} {sense['rank']:6s} {sense['pos']:11s} {('['+labels+'] ') if labels else ''}{sense['gloss']}")


def show_entry(lemma, kinds=None):
    view = need(*call('GET', '/entries/' + urllib.parse.quote(lemma)))
    print(f"entry {view['entry']['id']} {view['entry']['lemma']} live={view['live']} batch={view['batch']} "
          f"completeness={view['completeness']:.2f} credibility={view['credibility']}")
    inventory_lines(view)
    for fact in view['facts']:
        if fact['kind'] == 'senses' or (kinds and fact['kind'] not in kinds):
            continue
        if fact['status'] in ('published', 'pending') or (kinds and fact['status'] == 'rejected'):
            review = fact.get('review') or {}
            reason = f" | {review.get('reviewer')}: {review.get('reason', '')[:400]}" if fact['status'] == 'rejected' else ''
            print(f"{fact['kind']:13s} {fact['id']} [{fact['status']}] subject={fact['subject_id'][:8]} "
                  f"{json.dumps(fact['payload'], ensure_ascii=False)[:300]}{reason}")
    return view


KIND_OF_TYPE = {
    'senses': 'senses', 'phrases': 'phrases', 'translations': 'translation', 'morphology': 'morphology',
    'forms': 'form', 'synonyms': 'relation', 'category': 'relation', 'parts': 'relation', 'family': 'morphology',
    'examples': 'example', 'collocations': 'collocation', 'topics': 'topic', 'pronunciation': 'pronunciation',
    'syllables': 'syllables', 'form_pronunciations': 'pronunciation',
}


def show_ticket(ticket_id):
    ticket = need(*call('GET', f'/tickets/{ticket_id}'))
    print(f"ticket {ticket['id']} {ticket['type']} {ticket['status']} target={ticket['target_type']}:{ticket['target']}")
    print(f"message: {ticket['message']}")
    if not ticket['entry']:
        return
    kinds = None
    if ticket['type'] == 'stuck_work':
        kinds = {KIND_OF_TYPE.get(ticket['message'].split(':')[0], '')}
    elif ticket['type'] == 'audit':
        kinds = {'senses'}
    view = show_entry(ticket['entry']['lemma'], kinds)
    if ticket['type'] in ('stuck_work', 'audit'):
        rejected = [f for f in view['facts'] if f['kind'] in kinds and f['status'] == 'rejected']
        for fact in rejected[-3:]:
            review = fact.get('review') or {}
            print(f"rejected {fact['kind']} {fact['id']} at {fact['updated_at']}: {review.get('reason', '')[:900]}")
            if fact['kind'] == 'senses':
                for at, sense in enumerate(fact['payload']['senses'], 1):
                    print(f"     {at:2d}. {sense['rank']:6s} {sense['pos']:11s} {sense['gloss']}")
            elif fact['kind'] == 'phrases':
                print('     phrases:', json.dumps(fact['payload']['phrases'], ensure_ascii=False))


def main(argv):
    command, *args = argv
    if command == 'tickets':
        kind, limit, *cursor = args + ['50'][len(args) - 1:] if len(args) == 1 else args
        query = {'status': 'open', 'type': kind, 'limit': limit}
        if cursor:
            query['cursor'] = cursor[0]
        page = need(*call('GET', '/tickets?' + urllib.parse.urlencode(query)))
        for t in page['items']:
            print(t['id'], (t['entry'] or {}).get('lemma'), '|', t['message'][:200])
        print('next_cursor', page['next_cursor'])
    elif command == 'show':
        show_ticket(args[0])
    elif command == 'entry':
        show_entry(args[0])
    elif command == 'submit':
        body = json.loads(Path(args[0]).read_text())
        body['curation'] = {'reason': args[1]}
        fact = need(*call('POST', '/facts', body))['fact']
        print('fact', fact['id'], fact['status'])
    elif command == 'resolve':
        body = {'resolution': 'resolved', 'note': args[1], 'fact_ids': args[2:]}
        print(need(*call('POST', f'/tickets/{args[0]}/resolve', body))['status'])
    elif command == 'dismiss':
        print(need(*call('POST', f'/tickets/{args[0]}/resolve', {'resolution': 'dismissed', 'note': args[1]}))['status'])
    elif command == 'settle':
        entry_id, work_type, subject_id, note = args
        need(*call('POST', f'/entries/{entry_id}/passes', {'type': work_type, 'subject_id': subject_id, 'note': note}))
        print('settled')
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
