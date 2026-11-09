"""Exports the raw reference datasets as one JSON document on stdout.

Usage: python -I scripts/reference/export.py <download-dir> > raw.json

Downloads each CEFR profile named in sources.json into <download-dir> unless it is already
there, refuses a file whose SHA-256 differs from the manifest, and reads the wordfreq list from
the pinned package. It only converts formats; scripts/reference/build.mjs applies the import
rules (server/domain/reference.ts) and writes the SQL.
"""

import csv
import hashlib
import io
import json
import sys
import urllib.request
import zipfile
from importlib.metadata import version
from pathlib import Path

import openpyxl
from wordfreq import iter_wordlist, zipf_frequency

MANIFEST = json.loads((Path(__file__).parent / "sources.json").read_text())


def fetch(source, directory):
    target = directory / Path(source["download"]).name
    if not target.exists():
        urllib.request.urlretrieve(source["download"], target)
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    if digest != source["sha256"]:
        raise SystemExit(f"{target}: SHA-256 {digest} does not match {source['sha256']} in sources.json")
    return target


def cefrj_xlsx(path):
    with zipfile.ZipFile(path) as archive:
        [name] = [n for n in archive.namelist() if n.endswith(".xlsx")]
        book = openpyxl.load_workbook(io.BytesIO(archive.read(name)), read_only=True)
    rows = book["ALL"].iter_rows(values_only=True)
    header = next(rows)[:3]
    if header != ("headword", "pos", "CEFR"):
        raise SystemExit(f"{path}: unexpected header {header}")
    return [[str(cell) for cell in row[:3]] for row in rows if row[0] is not None]


def olp_csv(path):
    with open(path, newline="", encoding="utf-8") as file:
        return [[row["headword"], row["pos"], row["CEFR"]] for row in csv.DictReader(file)]


READERS = {"cefrj-xlsx": cefrj_xlsx, "olp-csv": olp_csv}


def wordfreq_forms():
    pinned = MANIFEST["frequency"]["package"].split("==")[1]
    if version("wordfreq") != pinned:
        raise SystemExit(f"wordfreq {version('wordfreq')} is installed; sources.json pins {pinned}")
    return [[form, zipf_frequency(form, "en", wordlist="large")] for form in iter_wordlist("en", wordlist="large")]


def main():
    directory = Path(sys.argv[1])
    directory.mkdir(parents=True, exist_ok=True)
    cefr = {source["id"]: READERS[source["format"]](fetch(source, directory)) for source in MANIFEST["cefr"]}
    json.dump({"wordfreq": wordfreq_forms(), "cefr": cefr}, sys.stdout, ensure_ascii=False)


main()
