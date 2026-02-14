#!/usr/bin/env python3
"""ECDICT contrib source for vocnet pipeline.

Provides lexeme enrichment (Chinese translations, frequencies, phonetics)
from the ECDICT SQLite database via JSON-RPC over stdio.

Data source: ECDICT SQLite database (ecdict.db)
Stage: lexical
"""

import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path


# --- POS mapping (ECDICT short tags -> vocnet PartOfSpeech) ---

POS_MAP = {
    "n": "noun",
    "v": "verb",
    "vt": "verb",
    "vi": "verb",
    "adj": "adjective",
    "a": "adjective",
    "adv": "adverb",
    "ad": "adverb",
    "prep": "preposition",
    "pron": "pronoun",
    "conj": "conjunction",
    "interj": "interjection",
    "int": "interjection",
    "num": "numeral",
    "art": "determiner",
    "det": "determiner",
    "abbr": "noun",         # abbreviations treated as nouns
    "aux": "auxiliary",
    "modal": "auxiliary",
    "pl": "noun",           # plural nouns
    "vbl": "verb",          # verbal
    "va": "verb",           # adjective-verb
    "comb": "adjective",    # combining form
    "npl": "noun",          # plural noun
    "suf": "suffix",
    "pref": "prefix",
}

# Domain category tags from ECDICT
DOMAIN_CATEGORIES = {
    "zk": "middle_school",
    "gk": "college_entrance",
    "ky": "graduate_entrance",
    "cet4": "cet4",
    "cet6": "cet6",
    "toefl": "toefl",
    "ielts": "ielts",
    "gre": "gre",
}


def parse_pos(pos_raw):
    """Map an ECDICT POS tag to vocnet PartOfSpeech."""
    return POS_MAP.get(pos_raw.lower().strip())


def parse_chinese_translations(translation):
    """Parse ECDICT translation field into POS-grouped Chinese senses.

    Format: "n. world, realm\\nvt. globalize"
    Returns: {pos: [{language, gloss}]}
    """
    if not translation:
        return {}

    result = {}
    for line in translation.split("\n"):
        line = line.strip()
        if not line:
            continue

        dot_idx = line.find(".")
        if dot_idx <= 0:
            continue

        pos_raw = line[:dot_idx].strip()
        gloss = line[dot_idx + 1 :].strip()

        if len(pos_raw) > 6 or not gloss:
            continue

        pos = parse_pos(pos_raw)
        if not pos:
            continue

        if pos not in result:
            result[pos] = []
        result[pos].append({"language": "zh", "gloss": gloss})

    return result


def extract_domain_categories(tags):
    """Extract domain categories from ECDICT tag string."""
    if not tags:
        return []
    categories = []
    for tag in tags.split():
        tag = tag.strip().lower()
        if tag in DOMAIN_CATEGORIES:
            categories.append(DOMAIN_CATEGORIES[tag])
    return categories


def calculate_completeness(entry):
    """Calculate a completeness score for the ECDICT entry."""
    score = 0
    if entry.get("translation"):
        score += 40
    if entry.get("phonetic"):
        score += 20
    if entry.get("pos"):
        score += 15
    if entry.get("collins", 0) > 0:
        score += 10
    if entry.get("oxford", 0) > 0:
        score += 10
    if entry.get("exchange"):
        score += 5
    return min(score, 100)


ECDICT_URL = "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip"
ECDICT_MIN_SIZE = 10 * 1024 * 1024  # 10MB


class ECDICTSource:
    def __init__(self):
        self.db = None
        self.data_dir = os.environ.get(
            "PIPELINE_DATA_DIR", os.environ.get("ECDICT_DATA_DIR", "./data")
        )
        self.cache_dir = os.environ.get(
            "PIPELINE_CACHE_DIR", os.path.join(Path.home(), ".cache", "vocnet")
        )

    def initialize(self):
        db_path = os.path.join(
            self.data_dir, "datasources", "ecdict", "ecdict.db"
        )
        if not os.path.exists(db_path):
            raise FileNotFoundError(
                f"ECDICT database not found: {db_path}. "
                "Run 'vocnet pipeline source download ecdict' first."
            )

        self.db = sqlite3.connect(db_path)
        self.db.execute("PRAGMA query_only = ON")
        self.db.row_factory = sqlite3.Row

        return {
            "name": "ecdict",
            "version": "1.0.0",
            "languages": ["en"],
            "capabilities": ["enrichment", "forms", "metadata"],
            "stage": "lexical",
        }

    def lookup(self, params):
        term = params.get("term", "")
        if not term or not self.db:
            return {}

        cursor = self.db.execute(
            """
            SELECT word, COALESCE(phonetic, '') as phonetic,
                   COALESCE(definition, '') as definition,
                   COALESCE(translation, '') as translation,
                   COALESCE(pos, '') as pos,
                   COALESCE(tag, '') as tag,
                   COALESCE(bnc, 0) as bnc,
                   COALESCE(frq, 0) as frq,
                   COALESCE(collins, 0) as collins,
                   COALESCE(oxford, 0) as oxford,
                   COALESCE(exchange, '') as exchange
            FROM stardict
            WHERE word = ? COLLATE NOCASE
            LIMIT 1
            """,
            (term.lower(),),
        )

        row = cursor.fetchone()
        if not row:
            return {}

        entry = dict(row)
        translations_by_pos = parse_chinese_translations(entry["translation"])
        categories = extract_domain_categories(entry["tag"])
        completeness = calculate_completeness(entry)

        # Return one lexeme per POS with Chinese translations
        lexemes = []
        for pos, senses in translations_by_pos.items():
            lexemes.append(
                {
                    "language": "en",
                    "part_of_speech": pos,
                    "senses": senses,
                    "categories": categories,
                    "completeness": completeness,
                }
            )

        # Build form with phonetics
        forms = []
        if entry["phonetic"]:
            forms.append(
                {
                    "surface": term,
                    "form_type": "lemma",
                    "phonetics": [{"ipa": entry["phonetic"], "dialect": "en-GB"}],
                }
            )

        # Lemma update with frequencies
        lemma_update = None
        frequencies = []
        if entry["bnc"] > 0:
            frequencies.append({"corpus": "bnc", "count": entry["bnc"]})
        if entry["frq"] > 0:
            frequencies.append({"corpus": "frq", "count": entry["frq"]})
        if frequencies:
            lemma_update = {"frequencies": frequencies}

        # Evidence
        evidence = {
            "provider": "ecdict",
            "phase": 2,  # lexical
            "content": {
                "word": entry["word"],
                "phonetic": entry["phonetic"],
                "definition": entry["definition"],
                "translation": entry["translation"],
                "pos": entry["pos"],
                "tags": entry["tag"],
                "bnc": entry["bnc"],
                "frq": entry["frq"],
                "collins": entry["collins"],
                "oxford": entry["oxford"],
                "exchange": entry["exchange"],
            },
            "schema_version": "ecdict-1.0",
        }

        result = {"evidence": evidence}
        if lexemes:
            result["lexemes"] = lexemes
        if forms:
            result["forms"] = forms
        if lemma_update:
            result["lemma_update"] = lemma_update

        return result

    def download(self, params):
        """Download and extract ECDICT database."""
        db_path = os.path.join(
            self.data_dir, "datasources", "ecdict", "ecdict.db"
        )

        # Check if already exists
        if os.path.exists(db_path):
            if self._verify_db(db_path):
                return {"status": "already_exists", "path": db_path}

        # Prepare cache directory
        os.makedirs(self.cache_dir, mode=0o755, exist_ok=True)

        # Check cache for downloaded zip
        url_hash = hashlib.sha256(ECDICT_URL.encode()).hexdigest()[:16]
        cache_file = os.path.join(self.cache_dir, f"ecdict-{url_hash}.zip")

        # Download if not in cache
        if not os.path.exists(cache_file):
            self._download_file(ECDICT_URL, cache_file)

        # Extract database from zip
        os.makedirs(os.path.dirname(db_path), mode=0o755, exist_ok=True)
        self._extract_db_from_zip(cache_file, db_path)

        # Verify downloaded database
        if not self._verify_db(db_path):
            raise Exception(f"Downloaded database failed verification: {db_path}")

        return {
            "status": "downloaded",
            "path": db_path,
            "size": os.path.getsize(db_path),
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

    def _extract_db_from_zip(self, zip_path, dest_path):
        """Extract .db file from zip archive."""
        with zipfile.ZipFile(zip_path, 'r') as zf:
            # Find .db or .sqlite file in zip
            db_files = [f for f in zf.namelist() if f.endswith(('.db', '.sqlite'))]
            if not db_files:
                raise Exception("No .db file found in zip archive")

            # Extract first .db file found
            db_file = db_files[0]

            # Extract to temporary file then move atomically
            temp_fd, temp_path = tempfile.mkstemp(dir=os.path.dirname(dest_path))
            try:
                with os.fdopen(temp_fd, 'wb') as temp_file:
                    with zf.open(db_file) as source:
                        shutil.copyfileobj(source, temp_file)

                os.rename(temp_path, dest_path)
            except:
                os.unlink(temp_path)
                raise

    def _verify_db(self, db_path):
        """Verify database integrity."""
        try:
            # Check file size
            if os.path.getsize(db_path) < ECDICT_MIN_SIZE:
                return False

            # Verify SQLite header
            with open(db_path, 'rb') as f:
                header = f.read(16)
                if header != b'SQLite format 3\x00':
                    return False

            # Try to open and query
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            try:
                cursor = conn.execute("SELECT COUNT(*) FROM stardict LIMIT 1")
                cursor.fetchone()
                return True
            finally:
                conn.close()
        except Exception:
            return False

    def shutdown(self):
        if self.db:
            self.db.close()
            self.db = None


def main():
    source = ECDICTSource()

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
