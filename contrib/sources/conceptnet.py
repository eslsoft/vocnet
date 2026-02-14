#!/usr/bin/env python3
"""ConceptNet contrib source for vocnet pipeline.

Provides semantic relations from the ConceptNet 5.7 SQLite index
via JSON-RPC over stdio.

Data source: ConceptNet assertions CSV + SQLite index (*.idx.db)
Stage: relational
"""

import gzip
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path


CONCEPTNET_URL = "https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz"
CONCEPTNET_CSV_NAME = "conceptnet-assertions-5.7.0.csv"
CONCEPTNET_MIN_SIZE = 100 * 1024 * 1024  # 100MB

# --- Relation mapping (ConceptNet labels -> vocnet RelationType) ---

RELATION_MAP = {
    "Synonym": "SYNONYM",
    "Antonym": "ANTONYM",
    "IsA": "HYPERNYM",
    "RelatedTo": "ASSOCIATION",
    "Causes": "CAUSE_EFFECT",
    "PartOf": "PART_WHOLE",
    "HasA": "PART_WHOLE",
    "DerivedFrom": "DERIVATIVE",
    "EtymologicallyDerivedFrom": "DERIVATIVE",
}


def extract_relation_label(uri):
    """Extract label from relation URI: /r/Synonym -> Synonym"""
    parts = uri.split("/")
    if len(parts) >= 3 and parts[1] == "r":
        return parts[2]
    return ""


def extract_term_info(uri):
    """Extract language and term from concept URI: /c/en/hello -> (en, hello)"""
    parts = uri.split("/")
    if len(parts) >= 4 and parts[1] == "c":
        return parts[2], parts[3]
    return "", ""


def normalize_weight(weight):
    """Normalize ConceptNet weight to [0, 1) range."""
    if weight <= 0:
        return 0.0
    return weight / (weight + 1.0)


def concept_net_term_ref(language, term):
    """Build a ConceptNet term reference URI."""
    lang = language.lower().strip() or "en"
    surface = term.lower().strip().replace(" ", "_")
    if not surface:
        return ""
    return f"conceptnet://c/{lang}/{urllib.parse.quote(surface)}"


class ConceptNetSource:
    def __init__(self):
        self.db = None
        self.data_dir = os.environ.get(
            "PIPELINE_DATA_DIR", os.environ.get("CONCEPTNET_DATA_DIR", "./data")
        )
        self.cache_dir = os.environ.get(
            "PIPELINE_CACHE_DIR", os.path.join(Path.home(), ".cache", "vocnet")
        )

    def initialize(self):
        csv_path = os.path.join(
            self.data_dir,
            "datasources",
            "conceptnet",
            "conceptnet-assertions-5.7.0.csv",
        )
        db_path = csv_path + ".idx.db"

        if not os.path.exists(db_path):
            raise FileNotFoundError(
                f"ConceptNet index not found: {db_path}. "
                "Run 'vocnet pipeline source download conceptnet' first."
            )

        self.db = sqlite3.connect(db_path)
        self.db.execute("PRAGMA query_only = ON")

        return {
            "name": "conceptnet",
            "version": "5.7.0",
            "languages": ["en"],
            "capabilities": ["relations"],
            "stage": "relational",
        }

    def lookup(self, params):
        term = params.get("term", "")
        language = params.get("language", "en")
        if not term or not self.db:
            return {}

        search_term = f"/c/{language}/{term.lower()}"

        cursor = self.db.execute(
            """
            SELECT relation, start_uri, end_uri, weight
            FROM edges
            WHERE start_uri = ? OR end_uri = ?
            LIMIT 100
            """,
            (search_term, search_term),
        )

        relations = []
        for row in cursor:
            relation_uri, start_uri, end_uri, weight = row

            # Filter low-signal edges
            if weight <= 1.0:
                continue

            rel_label = extract_relation_label(relation_uri)
            rel_type = RELATION_MAP.get(rel_label, "")
            if not rel_type:
                continue

            start_lang, start_term = extract_term_info(start_uri)
            end_lang, end_term = extract_term_info(end_uri)

            if not start_term or not end_term:
                continue

            # Skip cross-language edges
            if start_lang != language or end_lang != language:
                continue

            # Determine target (the other side from the query term)
            target_term = end_term
            target_lang = end_lang
            if end_term == term.lower():
                target_term = start_term
                target_lang = start_lang

            relations.append(
                {
                    "target_ref": concept_net_term_ref(target_lang, target_term),
                    "target_term": target_term,
                    "relation_type": rel_type,
                    "provider": "conceptnet",
                    "strength": normalize_weight(weight),
                    "sense_mapped": False,
                }
            )

        if not relations:
            return {}

        evidence = {
            "provider": "conceptnet",
            "phase": 3,  # relational
            "content": {
                "source": "conceptnet-indexed",
                "term": term,
                "language": language,
                "edges_found": len(relations),
            },
            "schema_version": "conceptnet-5.7",
        }

        return {
            "relations": relations,
            "evidence": evidence,
        }

    def download(self, params):
        """Download and build ConceptNet SQLite index."""
        csv_path = os.path.join(
            self.data_dir,
            "datasources",
            "conceptnet",
            CONCEPTNET_CSV_NAME,
        )
        db_path = csv_path + ".idx.db"

        # Check if already exists
        if os.path.exists(csv_path) and os.path.exists(db_path):
            if self._verify_csv(csv_path) and self._verify_index(db_path):
                return {
                    "status": "already_exists",
                    "csv_path": csv_path,
                    "db_path": db_path,
                }

        # Prepare cache directory
        os.makedirs(self.cache_dir, mode=0o755, exist_ok=True)

        # Check cache for downloaded gz
        url_hash = hashlib.sha256(CONCEPTNET_URL.encode()).hexdigest()[:16]
        cache_file = os.path.join(self.cache_dir, f"conceptnet-{url_hash}.csv.gz")

        # Download if not in cache
        if not os.path.exists(cache_file):
            self._download_file(CONCEPTNET_URL, cache_file)

        # Extract CSV from gzip
        os.makedirs(os.path.dirname(csv_path), mode=0o755, exist_ok=True)
        self._extract_gz(cache_file, csv_path)

        # Build SQLite index
        self._build_index(csv_path, db_path)

        # Verify
        if not self._verify_csv(csv_path) or not self._verify_index(db_path):
            raise Exception(f"Downloaded data failed verification")

        return {
            "status": "downloaded",
            "csv_path": csv_path,
            "db_path": db_path,
            "csv_size": os.path.getsize(csv_path),
            "db_size": os.path.getsize(db_path),
        }

    def _download_file(self, url, dest_path):
        """Download a file with progress reporting."""
        with urllib.request.urlopen(url) as response:
            total_size = int(response.headers.get('Content-Length', 0))
            downloaded = 0
            chunk_size = 64 * 1024  # 64KB chunks

            # Use temporary file for atomic write
            temp_fd, temp_path = tempfile.mkstemp(dir=os.path.dirname(dest_path))
            try:
                with os.fdopen(temp_fd, 'wb') as temp_file:
                    while True:
                        chunk = response.read(chunk_size)
                        if not chunk:
                            break
                        temp_file.write(chunk)
                        downloaded += len(chunk)

                        # Report progress every 10MB
                        if downloaded % (10 * 1024 * 1024) < chunk_size:
                            percent = (downloaded / total_size * 100) if total_size else 0
                            print(f"Download progress: {downloaded // (1024*1024)}MB / {total_size // (1024*1024)}MB ({percent:.1f}%)", file=sys.stderr)

                # Atomic rename
                os.rename(temp_path, dest_path)
            except:
                os.unlink(temp_path)
                raise

    def _extract_gz(self, gz_path, dest_path):
        """Extract gzip file."""
        # Use temporary file for atomic write
        temp_fd, temp_path = tempfile.mkstemp(dir=os.path.dirname(dest_path))
        try:
            with os.fdopen(temp_fd, 'wb') as temp_file:
                with gzip.open(gz_path, 'rb') as gz_file:
                    chunk_size = 64 * 1024
                    while True:
                        chunk = gz_file.read(chunk_size)
                        if not chunk:
                            break
                        temp_file.write(chunk)

            os.rename(temp_path, dest_path)
        except:
            os.unlink(temp_path)
            raise

    def _build_index(self, csv_path, db_path):
        """Build SQLite index from CSV."""
        print(f"Building ConceptNet SQLite index...", file=sys.stderr)

        # Use temporary database, rename on success
        temp_fd, temp_path = tempfile.mkstemp(suffix='.db', dir=os.path.dirname(db_path))
        os.close(temp_fd)

        try:
            conn = sqlite3.connect(temp_path)

            # Performance pragmas
            conn.execute("PRAGMA journal_mode=OFF")
            conn.execute("PRAGMA synchronous=OFF")
            conn.execute("PRAGMA cache_size=-262144")  # 256MB cache
            conn.execute("PRAGMA temp_store=MEMORY")

            # Create table without indices
            conn.execute("""
                CREATE TABLE edges (
                    start_uri TEXT NOT NULL,
                    end_uri   TEXT NOT NULL,
                    relation  TEXT NOT NULL,
                    weight    REAL NOT NULL DEFAULT 1.0
                )
            """)

            # Bulk insert from CSV
            line_count = 0
            insert_count = 0

            with open(csv_path, 'r', encoding='utf-8') as f:
                cursor = conn.cursor()
                for line in f:
                    line_count += 1
                    fields = line.rstrip('\n').split('\t')
                    if len(fields) < 5:
                        continue

                    relation_uri = fields[1]
                    start_uri = fields[2]
                    end_uri = fields[3]
                    metadata_json = fields[4]

                    # Only index relations we care about
                    rel_label = extract_relation_label(relation_uri)
                    if rel_label not in RELATION_MAP:
                        continue

                    # Extract weight from metadata
                    weight = 1.0
                    if '"weight":' in metadata_json:
                        try:
                            import re
                            match = re.search(r'"weight":\s*([0-9.]+)', metadata_json)
                            if match:
                                weight = float(match.group(1))
                        except:
                            pass

                    cursor.execute(
                        "INSERT INTO edges (start_uri, end_uri, relation, weight) VALUES (?, ?, ?, ?)",
                        (start_uri, end_uri, relation_uri, weight)
                    )
                    insert_count += 1

                    # Progress logging
                    if line_count % 5_000_000 == 0:
                        conn.commit()
                        print(f"Indexing progress: {line_count} lines, {insert_count} edges", file=sys.stderr)

            conn.commit()

            # Create indices
            print(f"Creating indices...", file=sys.stderr)
            conn.execute("CREATE INDEX idx_edges_start ON edges(start_uri)")
            conn.execute("CREATE INDEX idx_edges_end ON edges(end_uri)")
            conn.commit()

            conn.close()

            # Atomic rename
            os.rename(temp_path, db_path)

            print(f"Index built: {line_count} lines scanned, {insert_count} edges indexed", file=sys.stderr)
        except:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise

    def _verify_csv(self, csv_path):
        """Verify CSV file."""
        try:
            if os.path.getsize(csv_path) < CONCEPTNET_MIN_SIZE:
                return False

            # Check if readable
            with open(csv_path, 'r', encoding='utf-8') as f:
                f.read(1024)
            return True
        except Exception:
            return False

    def _verify_index(self, db_path):
        """Verify SQLite index."""
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            try:
                cursor = conn.execute("SELECT COUNT(*) FROM edges LIMIT 1")
                count = cursor.fetchone()[0]
                return count > 0
            finally:
                conn.close()
        except Exception:
            return False

    def shutdown(self):
        if self.db:
            self.db.close()
            self.db = None


def main():
    source = ConceptNetSource()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = request.get("method", "")
        req_id = request.get("id", 0)

        try:
            if method == "initialize":
                result = source.initialize()
            elif method == "lookup":
                result = source.lookup(request.get("params", {}))
            elif method == "download":
                result = source.download(request.get("params", {}))
            elif method == "shutdown":
                source.shutdown()
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": None,
                }
                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()
                break
            else:
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32601,
                        "message": f"Method not found: {method}",
                    },
                }
                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()
                continue

            response = {"jsonrpc": "2.0", "id": req_id, "result": result}
        except Exception as e:
            response = {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32000, "message": str(e)},
            }

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
