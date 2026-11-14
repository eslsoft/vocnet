"""Follow-up to sentences.py: restore the phrases passes that found no phrases.

sentences.py deleted every phrases pass to reopen the headwords whose lists it converted, but a
pass is also how a headword records that a producer looked and found no phrases. About 3,700
headwords that had no list were reopened and queued for a list again. This restores, from the
backup taken before sentences.py, each phrases pass (and its blocks) of a headword that still has
no phrases fact of any status and no pass now, and marks those entries stale so the next rescore
closes their phrases items. Run with the server stopped and a backup taken:
    python3 -I scripts/migrate/phrase_passes.py <d1.sqlite> <pre-sentences backup.sqlite> [--dry-run]
"""
import json
import sqlite3
import sys

RESTORABLE = """
    from old.work_passes p
    where p.type = 'phrases'
      and exists (select 1 from main.entries e where e.id = p.entry_id)
      and not exists (select 1 from main.facts f where f.kind = 'phrases' and f.subject_id = p.subject_id)
      and not exists (select 1 from main.work_passes q where q.type = 'phrases' and q.subject_id = p.subject_id)
"""


def main(path, backup, dry_run):
    db = sqlite3.connect(f'file:{path}', uri=True)
    db.execute('pragma trusted_schema = 1')
    db.execute('attach database ? as old', (f'file:{backup}?immutable=1',))
    db.execute('begin')
    entries = [row[0] for row in db.execute(f'select p.entry_id {RESTORABLE}')]
    db.execute(
        'insert into main.work_pass_blocks (lemma, type, subject_id) '
        f'select b.lemma, b.type, b.subject_id from old.work_pass_blocks b where b.type = \'phrases\' '
        f'and b.subject_id in (select p.subject_id {RESTORABLE})'
    )
    blocks = db.execute('select changes()').fetchone()[0]
    db.execute(
        'insert into main.work_passes (entry_id, type, subject_id, note, holder, created_at) '
        f'select p.entry_id, p.type, p.subject_id, p.note, p.holder, p.created_at {RESTORABLE}'
    )
    passes = db.execute('select changes()').fetchone()[0]
    db.executemany('update worklist set revision = revision + 1 where entry_id = ?', [(e,) for e in entries])
    left = db.execute(f'select count(*) {RESTORABLE}').fetchone()[0]
    report = {'passes_restored': passes, 'blocks_restored': blocks, 'entries_marked_stale': len(entries), 'left': left}
    if left:
        db.rollback()
        raise SystemExit(f'restorable passes remain after the insert: {report}')
    if dry_run:
        db.rollback()
    else:
        db.commit()
    print(json.dumps({**report, 'dry_run': dry_run}))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], '--dry-run' in sys.argv[3:])
