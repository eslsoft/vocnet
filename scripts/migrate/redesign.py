"""One-off data migration for the production redesign (docs/plans/2026-11-12-production-redesign.md).

Run after migrations 20261112041920_redesign and 20261112042013_redesign_slots are applied:

    python3 -I scripts/migrate/redesign.py <d1.sqlite> <report-dir> [--dry-run]

It rewrites the store in one transaction:
  1. headwords: every CEFR lemma and every seeded entry is batch 1 and live;
  2. phrases: a multiword entry with a published entry fact that contains a headword stays, listed by
     a pending phrases fact on each headword it contains (content words first);
  3. every other entry goes, with its senses, the facts about them, and relations to them;
  4. senses + sense_list become one senses inventory per entry: published when its sense list was,
     else pending (the review queue judges it);
  5. translations: sense equivalents get `of: sense` and a zh slot; an example's zh becomes its own
     published translation fact;
  6. published gap closures become passes; gap_closure, entry, sense and sense_list facts go;
  7. work items, leases, the work history and the public view are cleared and every entry marked
     stale, so the rescore and the view rebuild recompute them.
The report dir gets counts (report.json) and the lemmas that relations lost (next-batch-candidates.csv).
"""

import csv
import json
import re
import sqlite3
import sys
import unicodedata
import uuid
from collections import defaultdict
from datetime import datetime, timezone

NOW = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.') + f'{datetime.now(timezone.utc).microsecond // 1000:03d}Z'

# Words too general to own a phrase when the phrase has a content word: "in front of" belongs to
# "front", not to "in" or "of".
FUNCTION_WORDS = set(
    'a an the of in on at to for from by with without about into onto over under up down out off away back '
    'and or but nor so as than that this these those it its one ones be is are was were been being have has had '
    'do does did not no yes all any some each every either neither both much many more most less least very too '
    'i me my you your he him his she her we us our they them their who whom whose what which when where why how'.split()
)


def normalize_term(raw):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFC', raw).strip())


def text_key(raw):
    return normalize_term(raw).lower()


def labelled(key, *labels):
    return '|'.join([key, *[label for label in labels if label]])


def inventory_key(senses):
    def key(sense):
        return labelled(f"{sense['pos']}:{text_key(sense['gloss'])}", sense.get('register'), sense.get('region'))

    common = [key(s) for s in senses if s['rank'] == 'common']
    extra = sorted(key(s) for s in senses if s['rank'] == 'extra')
    return f"{','.join(common)}|{','.join(extra)}"


def main(path, report_dir, dry_run):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    q = db.execute
    report = {}

    entries = {row['id']: dict(row) for row in q('select id, lemma, created_by from entries')}
    worklist = {row['entry_id']: dict(row) for row in q('select entry_id, batch, live from worklist')}
    cefr = {row['lemma'] for row in q('select distinct lemma from lemma_cefr')}
    facts = [dict(row) for row in q('select * from facts')]
    by_subject = defaultdict(list)
    for fact in facts:
        by_subject[fact['subject_id']].append(fact)
    senses = {row['id']: dict(row) for row in q('select id, entry_id, pos from senses')}
    senses_of = defaultdict(list)
    for sense in senses.values():
        senses_of[sense['entry_id']].append(sense)

    def published_of(subject, kind):
        return [f for f in by_subject[subject] if f['kind'] == kind and f['status'] == 'published']

    # 1. Headwords: the CEFR lemmas and the seeded entries.
    headwords = {eid for eid, e in entries.items() if e['lemma'] in cefr or (worklist.get(eid) or {}).get('batch') == 1}
    headwords = {eid for eid in headwords if ' ' not in entries[eid]['lemma'] or entries[eid]['lemma'] in cefr}
    by_lemma = {e['lemma'].lower(): eid for eid, e in entries.items() if eid in headwords and ' ' not in e['lemma']}
    report['headwords'] = len(headwords)

    # 2. Phrases: a published multiword entry that contains a single-word headword.
    phrases_of = defaultdict(list)
    phrase_entries = set()
    for eid, entry in entries.items():
        lemma = entry['lemma']
        if eid in headwords or ' ' not in lemma or not published_of(eid, 'entry'):
            continue
        words = [w.lower() for w in re.findall(r"[\w'’-]+", lemma)]
        heads = [by_lemma[w] for w in words if w in by_lemma]
        content = [h for h in heads if entries[h]['lemma'].lower() not in FUNCTION_WORDS]
        owners = content or heads[:1]
        if not owners:
            continue
        phrase_entries.add(eid)
        for owner in dict.fromkeys(owners):
            phrases_of[owner].append(lemma)
    # A CEFR phrase headword ("ice cream") is both: it stays a headword and is listed by its words too.
    for eid in headwords:
        lemma = entries[eid]['lemma']
        if ' ' in lemma:
            words = [w.lower() for w in re.findall(r"[\w'’-]+", lemma)]
            for owner in dict.fromkeys(by_lemma[w] for w in words if w in by_lemma and w not in FUNCTION_WORDS):
                phrases_of[owner].append(lemma)
    report['phrase_entries'] = len(phrase_entries)
    report['headwords_with_phrases'] = len(phrases_of)

    # 3. Entries that go.
    keep = headwords | phrase_entries
    gone = set(entries) - keep
    gone_senses = {sid for eid in gone for sid in (s['id'] for s in senses_of[eid])}
    report['entries_removed'] = len(gone)

    lost_targets = defaultdict(int)
    removed_fact_ids = set()
    for fact in facts:
        subject_gone = fact['subject_id'] in gone or fact['subject_id'] in gone_senses
        object_gone = fact['object_id'] in gone_senses if fact['object_id'] else False
        if subject_gone or object_gone:
            removed_fact_ids.add(fact['id'])
            if object_gone and not subject_gone and fact['kind'] == 'relation' and fact['status'] == 'published':
                lost_targets[entries[senses[fact['object_id']]['entry_id']]['lemma']] += 1
    report['facts_removed_with_entries'] = len(removed_fact_ids)

    # 4. Inventories.
    new_facts = []
    inventories = {'published': 0, 'pending': 0}
    dropped_senses = 0
    for eid in keep:
        own = senses_of[eid]
        if not own:
            continue
        glosses = {}
        for sense in own:
            glossed = [f for f in by_subject[sense['id']] if f['kind'] == 'sense' and f['status'] == 'published']
            if glossed:
                glossed.sort(key=lambda f: f['updated_at'])
                glosses[sense['id']] = json.loads(glossed[-1]['payload'])
        if not glosses:
            continue
        lists = published_of(eid, 'sense_list')
        listed = json.loads(lists[0]['payload']) if lists else None
        order = []
        if listed:
            order += [(sid, 'common') for sid in listed['common'] if sid in glosses]
            order += [(sid, 'extra') for sid in listed['extra'] if sid in glosses]
            dropped_senses += len([sid for sid in listed['common'] + listed['extra'] if sid not in glosses])
        placed = {sid for sid, _ in order}
        rest = sorted((s for s in own if s['id'] in glosses and s['id'] not in placed), key=lambda s: s['id'])
        order += [(s['id'], 'common') for s in rest]
        common = [item for item in order if item[1] == 'common']
        extra = [item for item in order if item[1] == 'extra']
        if not common:
            common, extra = extra[:1], extra[1:]
            common = [(sid, 'common') for sid, _ in common]
        payload = {
            'senses': [
                {
                    'id': sid,
                    'pos': senses[sid]['pos'],
                    'gloss': glosses[sid]['gloss'],
                    **({'register': glosses[sid]['register']} if glosses[sid].get('register') else {}),
                    **({'region': glosses[sid]['region']} if glosses[sid].get('region') else {}),
                    'rank': rank,
                }
                for sid, rank in common + extra
            ]
        }
        status = 'published' if listed and not rest else 'pending'
        inventories[status] += 1
        new_facts.append(
            {
                'id': str(uuid.uuid4()),
                'kind': 'senses',
                'subject_id': eid,
                'object_id': None,
                'content_key': inventory_key(payload['senses']),
                'payload': json.dumps(payload, ensure_ascii=False, separators=(',', ':')),
                'status': status,
                'slot': '',
                'supersedes_id': None,
                'author': lists[0]['author'] if listed else entries[eid]['created_by'],
                'review': lists[0]['review'] if status == 'published' else None,
                'created_at': NOW,
                'updated_at': NOW,
            }
        )
    report['inventories'] = inventories
    report['listed_senses_without_gloss_dropped'] = dropped_senses

    # 5. Translations.
    rewrites = []
    seen_slot = set()
    translation_stats = defaultdict(int)
    # One live translation per sense and language: the published one first, the newest first.
    translations = [f for f in facts if f['kind'] == 'translation' and f['id'] not in removed_fact_ids]
    translations.sort(key=lambda f: f['updated_at'], reverse=True)
    translations.sort(key=lambda f: f['status'] != 'published')
    for fact in translations:
        payload = json.loads(fact['payload'])
        new_payload = {'language': payload['language'], 'of': 'sense', 'text': payload['text']}
        status = fact['status']
        slot_key = (fact['subject_id'], payload['language'])
        if status in ('pending', 'published'):
            if slot_key in seen_slot:
                status = 'retracted'
                translation_stats['extra_live_retracted'] += 1
            else:
                seen_slot.add(slot_key)
        rewrites.append(
            (
                json.dumps(new_payload, ensure_ascii=False, separators=(',', ':')),
                f"{payload['language']}|sense|{text_key(payload['text'])}",
                'zh' if status in ('pending', 'published') else None,
                status,
                fact['id'],
            )
        )
        translation_stats['sense_equivalents'] += 1
    for fact in facts:
        if fact['kind'] != 'example' or fact['id'] in removed_fact_ids:
            continue
        payload = json.loads(fact['payload'])
        zh = (payload.get('translations') or {}).get('zh')
        rewrites.append(
            (
                json.dumps({'text': payload['text']}, ensure_ascii=False, separators=(',', ':')),
                text_key(payload['text']),
                None,
                fact['status'],
                fact['id'],
            )
        )
        if zh and fact['status'] == 'published':
            new_facts.append(
                {
                    'id': str(uuid.uuid4()),
                    'kind': 'translation',
                    'subject_id': fact['id'],
                    'object_id': None,
                    'content_key': f'zh|example|{text_key(zh)}',
                    'payload': json.dumps({'language': 'zh', 'of': 'example', 'text': zh}, ensure_ascii=False, separators=(',', ':')),
                    'status': 'published',
                    'slot': 'zh',
                    'supersedes_id': None,
                    'author': fact['author'],
                    'review': fact['review'],
                    'created_at': fact['created_at'],
                    'updated_at': NOW,
                }
            )
            translation_stats['example_translations_split'] += 1
    report['translations'] = dict(translation_stats)

    # 6. Passes from published closures.
    passes = []
    for fact in facts:
        if fact['kind'] != 'gap_closure' or fact['status'] != 'published' or fact['id'] in removed_fact_ids:
            continue
        payload = json.loads(fact['payload'])
        subject = fact['subject_id']
        entry_id = subject if subject in entries else senses.get(subject, {}).get('entry_id')
        if entry_id is None or entry_id not in keep:
            continue
        passes.append((entry_id, payload['gap'], subject, payload['reason'][:500], fact['author'], fact['updated_at']))
    report['passes_from_closures'] = len(passes)

    # Phrases facts, pending review.
    for owner, lemmas in phrases_of.items():
        unique = list(dict.fromkeys(lemmas))[:200]
        new_facts.append(
            {
                'id': str(uuid.uuid4()),
                'kind': 'phrases',
                'subject_id': owner,
                'object_id': None,
                'content_key': '|'.join(sorted(normalize_term(p) for p in unique)),
                'payload': json.dumps({'phrases': unique}, ensure_ascii=False, separators=(',', ':')),
                'status': 'pending',
                'slot': '',
                'supersedes_id': None,
                'author': entries[owner]['created_by'],
                'review': None,
                'created_at': NOW,
                'updated_at': NOW,
            }
        )
    report['phrases_facts'] = len(phrases_of)

    removed_kinds = ('entry', 'sense', 'sense_list', 'gap_closure')
    report['facts_of_removed_kinds'] = sum(1 for f in facts if f['kind'] in removed_kinds and f['id'] not in removed_fact_ids)

    if dry_run:
        print(json.dumps(report, indent=2))
        write_report(report_dir, report, lost_targets)
        return

    with db:
        db.execute('pragma foreign_keys = off')
        ids = list(removed_fact_ids)
        for chunk in range(0, len(ids), 500):
            part = ids[chunk : chunk + 500]
            db.execute(f"delete from facts where id in ({','.join('?' * len(part))})", part)
        db.execute(f"delete from facts where kind in ({','.join('?' * len(removed_kinds))})", removed_kinds)
        db.executemany('update facts set payload = ?, content_key = ?, slot = ?, status = ? where id = ?', rewrites)
        db.executemany(
            'insert into facts (id, kind, subject_id, object_id, content_key, payload, status, slot, supersedes_id, author, review, created_at, updated_at) '
            'values (:id, :kind, :subject_id, :object_id, :content_key, :payload, :status, :slot, :supersedes_id, :author, :review, :created_at, :updated_at)',
            new_facts,
        )
        db.executemany(
            'insert or ignore into work_passes (entry_id, type, subject_id, note, holder, created_at) values (?, ?, ?, ?, ?, ?)', passes
        )
        gone_list = list(gone)
        gone_sense_list = list(gone_senses)
        for table, column, values in (
            ('work_items', 'entry_id', gone_list),
            ('work_item_log', 'entry_id', gone_list),
            ('work_attempts', 'entry_id', gone_list),
            ('work_passes', 'entry_id', gone_list),
            ('tickets', 'target', gone_list + gone_sense_list),
            ('senses', 'entry_id', gone_list),
            ('worklist', 'entry_id', gone_list),
            ('entries', 'id', gone_list),
        ):
            for chunk in range(0, len(values), 500):
                part = values[chunk : chunk + 500]
                db.execute(f"delete from {table} where {column} in ({','.join('?' * len(part))})", part)
        db.execute('update worklist set live = 0, batch = null')
        keep_heads = list(headwords)
        for chunk in range(0, len(keep_heads), 500):
            part = keep_heads[chunk : chunk + 500]
            db.execute(f"update worklist set live = 1, batch = 1 where entry_id in ({','.join('?' * len(part))})", part)
        # The old work history names removed types (sense_list, example_translations, weak_fact) and
        # gaps in the old shapes, which the new contracts do not parse; the new system starts its own.
        db.execute('delete from work_attempts')
        db.execute('delete from work_item_log')
        db.execute('delete from work_items')
        db.execute('delete from work_leases')
        for table in ('public_entries', 'public_meanings', 'public_forms', 'public_sense_topics', 'public_search', 'public_hypernyms', 'public_phrase_words', 'public_morphemes'):
            db.execute(f'delete from {table}')
        db.execute('update worklist set revision = revision + 1, view_revision = 0')
        db.execute('pragma foreign_keys = on')
        violations = db.execute('pragma foreign_key_check').fetchall()
        if violations:
            raise SystemExit(f'foreign key violations: {violations[:5]}')
    print(json.dumps(report, indent=2))
    write_report(report_dir, report, lost_targets)


def write_report(report_dir, report, lost_targets):
    import os

    os.makedirs(report_dir, exist_ok=True)
    with open(os.path.join(report_dir, 'report.json'), 'w') as out:
        json.dump(report, out, indent=2)
    with open(os.path.join(report_dir, 'next-batch-candidates.csv'), 'w', newline='') as out:
        writer = csv.writer(out)
        writer.writerow(['lemma', 'relations_lost'])
        for lemma, count in sorted(lost_targets.items(), key=lambda item: -item[1]):
            writer.writerow([lemma, count])


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], '--dry-run' in sys.argv[3:])
