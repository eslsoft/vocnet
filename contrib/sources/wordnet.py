#!/usr/bin/env python3
"""WordNet contrib source for vocnet pipeline.

Provides semantic relations (hypernyms, hyponyms, antonyms, etc.)
from WordNet 3.1 data files via JSON-RPC over stdio.

Data source: WordNet dict files (data.noun, data.verb, data.adj, data.adv)
Stage: relational
"""

import json
import os
import sys
from collections import defaultdict


# --- Relation mapping (WordNet pointer symbols -> vocnet RelationType) ---

RELATION_MAP = {
    "@": "HYPERNYM",       # is-a (parent)
    "~": "HYPONYM",        # is-a (child)
    "#m": "MEMBER_HOLONYM",  # member of
    "#p": "PART_HOLONYM",    # part of
    "%m": "MEMBER_MERONYM",  # has member
    "%p": "PART_MERONYM",    # has part
    "=": "ATTRIBUTE",        # attribute
    "!": "ANTONYM",          # opposite
    "&": "SIMILAR",          # similar to
    "<": "PARTICIPLE_OF",    # verb form
    "\\": "DERIVED_FROM",    # derived/related form
    ";c": "CATEGORY",        # domain category
    "-c": "CATEGORY_MEMBER", # member of category
}


class Synset:
    """A WordNet synset (synonym set)."""

    __slots__ = ("offset", "pos", "words", "gloss", "relations", "hypernym_ids")

    def __init__(self, offset, pos, words, gloss, relations, hypernym_ids):
        self.offset = offset
        self.pos = pos
        self.words = words
        self.gloss = gloss
        self.relations = relations
        self.hypernym_ids = hypernym_ids


class SynsetRelation:
    """A relation pointer within a synset."""

    __slots__ = ("symbol", "target_id", "target_pos")

    def __init__(self, symbol, target_id, target_pos):
        self.symbol = symbol
        self.target_id = target_id
        self.target_pos = target_pos


def parse_synset_line(line):
    """Parse a WordNet data file line into a Synset."""
    parts = line.split(" | ", 1)
    data = parts[0].strip()
    gloss = parts[1].strip() if len(parts) > 1 else ""

    fields = data.split()
    if len(fields) < 6:
        return None

    offset = fields[0]
    pos = fields[2]

    # Parse word count (hex)
    try:
        w_cnt = int(fields[3], 16)
    except ValueError:
        return None

    # Parse words
    idx = 4
    words = []
    for _ in range(w_cnt):
        if idx + 1 >= len(fields):
            break
        word = fields[idx].replace("_", " ")
        words.append(word)
        idx += 2  # skip word + lex_id

    if idx >= len(fields):
        return Synset(offset, pos, words, gloss, [], [])

    # Parse pointer count
    try:
        p_cnt = int(fields[idx])
    except ValueError:
        return Synset(offset, pos, words, gloss, [], [])
    idx += 1

    # Parse relations
    relations = []
    hypernym_ids = []
    for _ in range(p_cnt):
        if idx + 3 > len(fields):
            break
        symbol = fields[idx]
        target_id = fields[idx + 1]
        target_pos = fields[idx + 2]
        # fields[idx+3] is source/target word numbers (skip)
        idx += 4

        relations.append(SynsetRelation(symbol, target_id, target_pos))
        if symbol == "@":
            hypernym_ids.append(target_id)

    return Synset(offset, pos, words, gloss, relations, hypernym_ids)


class WordNetSource:
    def __init__(self):
        self.word_index = defaultdict(list)  # lowercase word -> [Synset]
        self.offset_index = {}  # "pos:offset" -> Synset
        self.loaded = False
        self.data_dir = os.environ.get(
            "PIPELINE_DATA_DIR", os.environ.get("WORDNET_DATA_DIR", "./data")
        )

    def _load_data_file(self, filepath):
        """Load a single WordNet data file."""
        if not os.path.exists(filepath):
            return

        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith(" ") or not line.strip():
                    continue  # Skip license header

                synset = parse_synset_line(line.strip())
                if synset is None:
                    continue

                # Index by offset+POS
                key = f"{synset.pos}:{synset.offset}"
                self.offset_index[key] = synset

                # Index by each word
                for w in synset.words:
                    word_key = w.lower().replace(" ", "_")
                    self.word_index[word_key].append(synset)

    def _ensure_loaded(self):
        """Load all WordNet data files on first access."""
        if self.loaded:
            return

        wn_dir = os.path.join(self.data_dir, "datasources", "wordnet")
        for filename in ("data.noun", "data.verb", "data.adj", "data.adv"):
            self._load_data_file(os.path.join(wn_dir, filename))

        self.loaded = True

    def _lookup_synsets(self, word, pos_filter=""):
        """Find all synsets for a given word, optionally filtered by POS."""
        self._ensure_loaded()

        normalized = word.lower().replace(" ", "_")
        candidates = self.word_index.get(normalized, [])
        if not candidates:
            return []

        # Normalize POS filter
        pos_map = {
            "noun": "n", "n": "n",
            "verb": "v", "v": "v",
            "adjective": "a", "adj": "a", "a": "a",
            "adverb": "r", "adv": "r", "r": "r",
        }
        wn_pos = pos_map.get(pos_filter, "")

        # Separate exact case matches from case-insensitive
        word_with_spaces = word.replace("_", " ")
        exact = []
        inexact = []

        for synset in candidates:
            if wn_pos and synset.pos != wn_pos:
                continue
            if word_with_spaces in synset.words:
                exact.append(synset)
            else:
                inexact.append(synset)

        return exact + inexact

    def _get_hypernym_path(self, synset):
        """Get the hypernym hierarchy path for a synset."""
        self._ensure_loaded()

        path = [synset]
        visited = {synset.offset}
        current = synset

        while current.hypernym_ids:
            hypernym_id = current.hypernym_ids[0]
            if hypernym_id in visited:
                break

            key = f"{current.pos}:{hypernym_id}"
            hypernym = self.offset_index.get(key)
            if hypernym is None:
                break

            path.append(hypernym)
            visited.add(hypernym_id)
            current = hypernym

        return path

    def _wordnet_synset_ref(self, offset):
        """Build a wordnet synset reference URI."""
        offset = offset.strip()
        if not offset:
            return ""
        return f"wordnet://synset/{offset}"

    def initialize(self):
        self._ensure_loaded()

        if not self.word_index:
            raise FileNotFoundError(
                "WordNet data files not found. "
                "Run 'vocnet pipeline source download wordnet' first."
            )

        return {
            "name": "wordnet",
            "version": "3.1.0",
            "languages": ["en"],
            "capabilities": ["relations"],
            "stage": "relational",
        }

    def lookup(self, params):
        term = params.get("term", "")
        if not term:
            return {}

        # Try all POS — source returns everything it finds,
        # system decides what to use.
        pos_candidates = ["noun", "verb", "adjective", "adverb"]

        # Collect primary synsets (first match per POS)
        collected = []
        seen_synsets = set()
        for pos in pos_candidates:
            synsets = self._lookup_synsets(term, pos)
            if not synsets:
                continue
            primary = synsets[0]
            key = f"{primary.pos}:{primary.offset}"
            if key in seen_synsets:
                continue
            seen_synsets.add(key)
            collected.append(primary)

        if not collected:
            return {}

        # Extract relations
        relations = []
        relation_seen = set()

        for syn in collected:
            # Hypernym path
            hypernym_path = self._get_hypernym_path(syn)
            if len(hypernym_path) > 1:
                for i in range(len(hypernym_path) - 1):
                    parent = hypernym_path[i + 1]
                    target_word = parent.words[0] if parent.words else parent.offset

                    rel_key = f"HYPERNYM|{self._wordnet_synset_ref(parent.offset).lower()}|{target_word.lower()}"
                    if rel_key in relation_seen:
                        continue
                    relation_seen.add(rel_key)

                    relations.append(
                        {
                            "target_ref": self._wordnet_synset_ref(parent.offset),
                            "target_term": target_word,
                            "relation_type": "HYPERNYM",
                            "provider": "wordnet",
                            "strength": 1.0,
                            "sense_mapped": True,
                        }
                    )

            # Other relations
            for rel in syn.relations:
                if rel.symbol == "@":
                    continue  # Already handled via hypernym path

                rel_type = RELATION_MAP.get(rel.symbol, "")
                if not rel_type:
                    continue

                # Resolve target term
                target_term = rel.target_id
                target_key = f"{rel.target_pos}:{rel.target_id}"
                target_synset = self.offset_index.get(target_key)
                if target_synset and target_synset.words:
                    target_term = target_synset.words[0]

                rel_key = f"{rel_type}|{self._wordnet_synset_ref(rel.target_id).lower()}|{target_term.lower()}"
                if rel_key in relation_seen:
                    continue
                relation_seen.add(rel_key)

                relations.append(
                    {
                        "target_ref": self._wordnet_synset_ref(rel.target_id),
                        "target_term": target_term,
                        "relation_type": rel_type,
                        "provider": "wordnet",
                        "strength": 1.0,
                        "sense_mapped": True,
                    }
                )

        if not relations:
            return {}

        # Evidence
        evidence_synsets = []
        for syn in collected:
            evidence_synsets.append(
                {
                    "offset": syn.offset,
                    "pos": syn.pos,
                    "words": syn.words,
                    "gloss": syn.gloss,
                    "relations": len(syn.relations),
                }
            )

        evidence = {
            "provider": "wordnet",
            "phase": 3,  # relational
            "content": {
                "word": term,
                "pos_candidates": pos_candidates,
                "synsets": evidence_synsets,
            },
            "schema_version": "wordnet-3.1",
        }

        return {
            "relations": relations,
            "evidence": evidence,
        }

    def shutdown(self):
        pass  # No cleanup needed (in-memory data)


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
