#!/usr/bin/env python3
"""ConceptNet contrib source for vocnet pipeline.

Provides semantic relations from the ConceptNet 5.7 SQLite index
via JSON-RPC over stdio.

Data source: ConceptNet assertions CSV + SQLite index (*.idx.db)
Stage: relational
"""

import json
import os
import sqlite3
import sys
import urllib.parse


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

        ctx = params.get("context", {})
        context_lexemes = ctx.get("lexemes", []) if ctx else []

        # Get primary external ID from first context lexeme
        source_ext_id = ""
        if context_lexemes:
            source_ext_id = context_lexemes[0].get("external_id", "")
        if not source_ext_id:
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
                    "source_external_id": source_ext_id,
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
