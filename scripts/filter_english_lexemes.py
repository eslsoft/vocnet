#!/usr/bin/env python3
"""
Filter English lexemes from Wikidata lexemes dump.

This script reads the Wikidata lexemes JSON file and extracts only English lexemes
(language Q1860), saving them to a new file for faster processing.
"""

import json
import os
import sys
from pathlib import Path


def filter_english_lexemes(input_file: str, output_file: str):
    """Filter English lexemes from the input file."""
    input_path = Path(input_file).expanduser()
    output_path = Path(output_file).expanduser()

    if not input_path.exists():
        print(f"Error: Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Reading from: {input_path}")
    print(f"Writing to: {output_path}")
    print("Filtering English lexemes (language=Q1860)...")

    # Create output directory if needed
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Read and filter
    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    total = len(data)
    print(f"Total lexemes: {total:,}")

    # Filter English lexemes (Q1860)
    english_lexemes = [
        lexeme for lexeme in data
        if lexeme.get('language') == 'Q1860'
    ]

    print(f"English lexemes: {len(english_lexemes):,}")
    print(f"Filtered: {total - len(english_lexemes):,} ({(total - len(english_lexemes)) / total * 100:.1f}%)")

    # Write filtered data
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(english_lexemes, f, ensure_ascii=False, indent=None)

    print(f"Saved to: {output_path}")

    # Show some statistics
    if english_lexemes:
        print("\nSample lexeme:")
        sample = english_lexemes[0]
        print(f"  ID: {sample.get('id')}")
        print(f"  Lemma: {list(sample.get('lemmas', {}).values())[0].get('value') if sample.get('lemmas') else 'N/A'}")
        print(f"  Forms: {len(sample.get('forms', []))}")
        print(f"  Senses: {len(sample.get('senses', []))}")


def main():
    if len(sys.argv) > 1 and sys.argv[1] in ['-h', '--help']:
        print("Usage: python3 filter_english_lexemes.py [INPUT_FILE] [OUTPUT_FILE]")
        print()
        print("Defaults:")
        print("  INPUT_FILE: ~/lexemes/latest-lexemes.json")
        print("  OUTPUT_FILE: ~/lexemes/english-lexemes.json")
        sys.exit(0)

    input_file = sys.argv[1] if len(sys.argv) > 1 else "~/lexemes/latest-lexemes.json"
    output_file = sys.argv[2] if len(sys.argv) > 2 else "~/lexemes/english-lexemes.json"

    filter_english_lexemes(input_file, output_file)


if __name__ == "__main__":
    main()
