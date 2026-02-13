#!/usr/bin/env python3
"""ECDICT contrib source for vocnet pipeline.

Provides lexeme enrichment (Chinese translations, frequencies, phonetics)
from the ECDICT SQLite database via JSON-RPC over stdio.

Data source: ECDICT SQLite database (ecdict.db)
Stage: lexical
"""

import json
import os
import sqlite3
import sys


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


class ECDICTSource:
    def __init__(self):
        self.db = None
        self.data_dir = os.environ.get(
            "PIPELINE_DATA_DIR", os.environ.get("ECDICT_DATA_DIR", "./data")
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

        ctx = params.get("context", {})
        context_lexemes = ctx.get("lexemes", []) if ctx else []

        # Enrich existing lexemes with POS-matched Chinese translations
        lexemes = []
        for lex in context_lexemes:
            pos = lex.get("part_of_speech", "")
            senses = translations_by_pos.get(pos, [])
            if senses or categories:
                enriched = {
                    "external_id": lex.get("external_id", ""),
                    "language": lex.get("language", "en"),
                    "part_of_speech": pos,
                    "senses": senses,
                    "categories": categories,
                    "completeness": completeness,
                }
                if lex.get("sense_gloss"):
                    enriched["sense_gloss"] = lex["sense_gloss"]
                lexemes.append(enriched)

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
