#!/usr/bin/env python3
"""NLTK-based WordNet contrib source for vocnet pipeline.

Provides semantic relations (hypernyms, hyponyms, antonyms, etc.)
from WordNet via NLTK Python library, eliminating the need for
manual data file downloads and parsing.

Dependencies: nltk
Stage: relational
"""

import json
import os
import sys
from collections import defaultdict

try:
    import nltk
    from nltk.corpus import wordnet as wn
except ImportError:
    print("Error: nltk is not installed. Please install with: pip install nltk", file=sys.stderr)
    sys.exit(1)


# --- WordNet POS to vocnet POS mapping ---
WN_POS_MAP = {
    "n": "noun",
    "v": "verb",
    "a": "adj",
    "s": "adj",  # satellite adjective → adjective
    "r": "adv",
}


# --- Relation mapping (NLTK relation names -> vocnet RelationType) ---
RELATION_MAP = {
    "hypernyms": "HYPERNYM",         # is-a (parent)
    "hyponyms": "HYPONYM",           # is-a (child)
    "member_holonyms": "MEMBER_HOLONYM",  # member of
    "part_holonyms": "PART_HOLONYM",      # part of
    "member_meronyms": "MEMBER_MERONYM",  # has member
    "part_meronyms": "PART_MERONYM",      # has part
    "attributes": "ATTRIBUTE",            # attribute
    "similar_tos": "SIMILAR",            # similar to
    "verb_groups": "VERB_GROUP",         # verb group
    "derivationally_related_forms": "DERIVED_FROM",  # derived/related form
    "pertainyms": "PERTAINS_TO",         # pertainym (adjective -> noun)
    "entailments": "ENTAILS",            # entailment
    "causes": "CAUSES",                  # causation
    "also": "ALSO",                      # also relation
}


class WordNetSource:
    def __init__(self):
        self.initialized = False

    def _ensure_wordnet_data(self):
        """Ensure WordNet data is downloaded via NLTK."""
        if self.initialized:
            return

        try:
            # Try to access WordNet, download if not available
            wn.synsets("test")
            self.initialized = True
        except LookupError:
            print("WordNet data not found, downloading via NLTK...", file=sys.stderr)
            try:
                nltk.download('wordnet', quiet=True)
                nltk.download('omw-1.4', quiet=True)  # Open Multilingual Wordnet
                # Test access again
                wn.synsets("test")
                self.initialized = True
                print("WordNet data downloaded successfully", file=sys.stderr)
            except Exception as e:
                raise RuntimeError(f"Failed to download WordNet data: {e}")

    def _wordnet_synset_ref(self, synset):
        """Build a wordnet synset reference URI from NLTK synset."""
        if hasattr(synset, 'name'):
            return f"wordnet://synset/{synset.name()}"
        return f"wordnet://synset/{str(synset)}"

    def _extract_relations(self, synsets):
        """Extract all relations from the given synsets."""
        relations = []
        relation_seen = set()

        for synset in synsets:
            # Get all relation types supported by NLTK
            for method_name, relation_type in RELATION_MAP.items():
                if not hasattr(synset, method_name):
                    continue

                try:
                    related_items = getattr(synset, method_name)()
                    if not related_items:
                        continue

                    for related_item in related_items:
                        # Handle different types of relations
                        if method_name == "antonyms":
                            # Antonyms are on lemmas, not synsets
                            continue

                        if hasattr(related_item, 'name'):
                            target_ref = self._wordnet_synset_ref(related_item)
                            target_term = related_item.lemma_names()[0] if related_item.lemma_names() else str(related_item)
                        else:
                            # Handle lemma-level relations
                            target_ref = f"wordnet://lemma/{related_item.name()}"
                            target_term = related_item.name().split('.')[0]  # Extract word from lemma name

                        # Deduplicate relations
                        rel_key = f"{relation_type}|{target_ref.lower()}|{target_term.lower()}"
                        if rel_key in relation_seen:
                            continue
                        relation_seen.add(rel_key)

                        relations.append({
                            "target_ref": target_ref,
                            "target_term": target_term,
                            "relation_type": relation_type,
                            "provider": "wordnet",
                            "strength": 1.0,
                            "sense_mapped": True,
                            "source_pos": WN_POS_MAP.get(synset.pos(), ""),
                            "source_gloss": synset.definition(),
                        })

                except Exception as e:
                    # Skip relation if there's an error accessing it
                    continue

        return relations

    def _extract_lemma_antonyms(self, synsets):
        """Extract antonym relations at the lemma level."""
        relations = []
        relation_seen = set()

        for synset in synsets:
            for lemma in synset.lemmas():
                for antonym in lemma.antonyms():
                    target_ref = f"wordnet://lemma/{antonym.name()}"
                    target_term = antonym.name().split('.')[0]  # Extract word part

                    rel_key = f"ANTONYM|{target_ref.lower()}|{target_term.lower()}"
                    if rel_key in relation_seen:
                        continue
                    relation_seen.add(rel_key)

                    relations.append({
                        "target_ref": target_ref,
                        "target_term": target_term,
                        "relation_type": "ANTONYM",
                        "provider": "wordnet",
                        "strength": 1.0,
                        "sense_mapped": True,
                        "source_pos": WN_POS_MAP.get(synset.pos(), ""),
                        "source_gloss": synset.definition(),
                    })

        return relations

    def initialize(self):
        """Initialize the WordNet source."""
        self._ensure_wordnet_data()

        return {
            "name": "wordnet",
            "version": "3.1.0",
            "languages": ["en"],
            "capabilities": ["relations"],
            "stage": "relational",
        }

    def lookup(self, params):
        """Look up semantic relations for a term using NLTK WordNet."""
        term = params.get("term", "")
        if not term:
            return {}

        self._ensure_wordnet_data()

        # Get all synsets for the term
        synsets = wn.synsets(term)
        if not synsets:
            return {}

        # Limit to top synsets per POS to avoid overwhelming results
        pos_synsets = defaultdict(list)
        for synset in synsets:
            pos_synsets[synset.pos()].append(synset)

        # Take top 2 synsets per POS
        selected_synsets = []
        for pos, pos_list in pos_synsets.items():
            selected_synsets.extend(pos_list[:2])

        if not selected_synsets:
            return {}

        # Extract relations from synsets
        relations = self._extract_relations(selected_synsets)

        # Extract antonym relations at lemma level
        antonym_relations = self._extract_lemma_antonyms(selected_synsets)
        relations.extend(antonym_relations)

        if not relations:
            return {}

        # Build evidence
        evidence_synsets = []
        for synset in selected_synsets:
            evidence_synsets.append({
                "name": synset.name(),
                "pos": synset.pos(),
                "lemma_names": synset.lemma_names(),
                "definition": synset.definition(),
                "examples": synset.examples(),
                "relation_count": len([r for r in relations if synset.name() in r.get("target_ref", "")]),
            })

        evidence = {
            "provider": "wordnet",
            "phase": 3,  # relational
            "content": {
                "word": term,
                "synsets_found": len(synsets),
                "synsets_used": len(selected_synsets),
                "synsets": evidence_synsets,
            },
            "schema_version": "nltk-wordnet-3.1",
        }

        return {
            "relations": relations,
            "evidence": evidence,
        }

    def shutdown(self):
        """Shutdown the source (no cleanup needed)."""
        pass


def main():
    source = WordNetSource()

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
