"""Follow-up to sentences.py: rewrite stored gaps that still name example facts.

sentences.py moved example translations onto sentences but left the translation gaps stored on
work items (`gap`, `claimed_gap`) and in the task history (`work_item_log.gap`) in the old shape
`{ "of": "example", "id": <example fact id> }`, which the new gap schema refuses. Each such target
becomes `{ "of": "sentence", "id": <the example's sentence> }`; a target whose example names no
sentence is an error. Run with the server stopped and a backup taken:
    python3 -I scripts/migrate/sentences_gaps.py <d1.sqlite> [--dry-run]
"""
import json
import sqlite3
import sys

COLUMNS = [('work_items', 'gap'), ('work_items', 'claimed_gap'), ('work_item_log', 'gap')]


def main(path, dry_run):
    db = sqlite3.connect(path)
    db.execute('pragma trusted_schema = 1')
    sentence_of = dict(db.execute("select id, object_id from facts where kind = 'example'"))
    db.execute('begin')
    counts = {}
    for table, column in COLUMNS:
        rows = db.execute(f"select id, {column} from {table} where {column} like '%\"of\":\"example\"%'").fetchall()
        for row_id, raw in rows:
            gap = json.loads(raw)
            for target in gap.get('missing', []):
                if isinstance(target, dict) and target.get('of') == 'example':
                    sentence = sentence_of.get(target['id'])
                    if not sentence:
                        raise SystemExit(f'{table}.{column} {row_id}: example {target["id"]} names no sentence')
                    target['of'] = 'sentence'
                    target['id'] = sentence
            db.execute(f'update {table} set {column} = ? where id = ?', (json.dumps(gap, separators=(',', ':')), row_id))
        counts[f'{table}.{column}'] = len(rows)
    left = {
        f'{table}.{column}': db.execute(
            f"select count(*) from {table} where {column} like '%\"of\":\"example\"%'"
        ).fetchone()[0]
        for table, column in COLUMNS
    }
    print(json.dumps({'rewritten': counts, 'left_in_old_shape': left, 'committed': not dry_run}, indent=2))
    if any(left.values()):
        db.rollback()
        raise SystemExit('old-shape gaps remain; rolled back')
    if dry_run:
        db.rollback()
    else:
        db.commit()


if __name__ == '__main__':
    main(sys.argv[1], '--dry-run' in sys.argv[2:])
