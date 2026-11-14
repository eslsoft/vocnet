"""Follow-up to sentences.py: give each migrated phrases list its own content key.

A migrated list's types are provisional, but its content key was the key of the same items typed
that way, so a typed correction naming the same items with the same types was deduplicated into
the migrated list itself (200, nothing written) and about 400 headwords could not leave the
migrated state. The phrases content key now prefixes a migrated list's key with `migrated:`; this
rewrites the stored keys to match. Run with the server stopped and a backup taken:
    python3 -I scripts/migrate/migrated_list_keys.py <d1.sqlite> [--dry-run]
"""
import json
import sqlite3
import sys


def main(path, dry_run):
    db = sqlite3.connect(f'file:{path}', uri=True)
    db.execute('pragma trusted_schema = 1')
    db.execute('begin')
    db.execute(
        "update facts set content_key = 'migrated:' || content_key where kind = 'phrases' "
        "and json_extract(payload, '$.migrated') = 1 and content_key not like 'migrated:%'"
    )
    rewritten = db.execute('select changes()').fetchone()[0]
    left = db.execute(
        "select count(*) from facts where kind = 'phrases' and json_extract(payload, '$.migrated') = 1 "
        "and content_key not like 'migrated:%'"
    ).fetchone()[0]
    if left:
        db.rollback()
        raise SystemExit(f'{left} migrated lists still carry a typed key')
    db.rollback() if dry_run else db.commit()
    print(json.dumps({'rewritten': rewritten, 'dry_run': dry_run}))


if __name__ == '__main__':
    main(sys.argv[1], '--dry-run' in sys.argv[2:])
