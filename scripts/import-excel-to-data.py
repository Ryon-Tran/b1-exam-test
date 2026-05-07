#!/usr/bin/env python3
"""Import editable Excel fields back into exam-app/data.js.

This is intentionally conservative. By default it syncs fields that are safe
to update without rebuilding the exam layout: correct answers, accepted
answers, explanations, and Writing prompt image paths.

Use --sync-raw-lines only when you deliberately edited the dong_goc column and
want to replace a whole Reading part's raw lines.
"""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


APP_ROOT = Path(__file__).resolve().parents[1]
DATA_JS = APP_ROOT / "data.js"
DEFAULT_XLSX = APP_ROOT / "exports" / "exam-data-master.xlsx"
NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def compact_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def load_exam_data() -> dict[str, Any]:
    raw = DATA_JS.read_text(encoding="utf-8-sig").strip()
    raw = re.sub(r"^window\.EXAM_DATA\s*=\s*", "", raw)
    raw = re.sub(r";\s*$", "", raw)
    return json.loads(raw)


def save_exam_data(payload: dict[str, Any]) -> None:
    text = "window.EXAM_DATA = " + json.dumps(payload, ensure_ascii=False, indent=22) + ";"
    DATA_JS.write_text(text, encoding="utf-8")


def read_workbook_rows(path: Path) -> list[dict[str, str]]:
    with zipfile.ZipFile(path) as xlsx:
        shared_strings = read_shared_strings(xlsx)
        sheet_targets = read_sheet_targets(xlsx)
        target = sheet_targets.get("tat_ca_cau") or sheet_targets.get("cau_hoi")
        if not target:
            available = ", ".join(sheet_targets)
            raise SystemExit(f"Cannot find sheet 'tat_ca_cau' or 'cau_hoi'. Available: {available}")
        return read_sheet_rows(xlsx, target, shared_strings)


def read_shared_strings(xlsx: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in xlsx.namelist():
        return []
    root = ET.fromstring(xlsx.read("xl/sharedStrings.xml"))
    values = []
    for item in root.findall("main:si", NS):
        values.append("".join(node.text or "" for node in item.findall(".//main:t", NS)))
    return values


def read_sheet_targets(xlsx: zipfile.ZipFile) -> dict[str, str]:
    workbook = ET.fromstring(xlsx.read("xl/workbook.xml"))
    rels = ET.fromstring(xlsx.read("xl/_rels/workbook.xml.rels"))
    rel_targets = {
        rel.attrib["Id"]: normalize_sheet_target(rel.attrib["Target"])
        for rel in rels.findall("pkgrel:Relationship", NS)
    }
    sheets = {}
    for sheet in workbook.find("main:sheets", NS):
        name = sheet.attrib["name"]
        rel_id = sheet.attrib[f"{{{NS['rel']}}}id"]
        if rel_id in rel_targets:
            sheets[name] = rel_targets[rel_id]
    return sheets


def normalize_sheet_target(target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    if target.startswith("xl/"):
        return target
    return f"xl/{target}"


def read_sheet_rows(xlsx: zipfile.ZipFile, sheet_path: str, shared_strings: list[str]) -> list[dict[str, str]]:
    root = ET.fromstring(xlsx.read(sheet_path))
    raw_rows = []
    for row in root.findall(".//main:row", NS):
        values = {}
        for cell in row.findall("main:c", NS):
            ref = cell.attrib.get("r", "")
            column = column_index(ref)
            values[column] = cell_value(cell, shared_strings)
        if values:
            raw_rows.append(values)
    if not raw_rows:
        return []

    header_indexes = sorted(raw_rows[0])
    headers = [raw_rows[0].get(index, "") for index in header_indexes]
    rows = []
    for raw in raw_rows[1:]:
        row = {}
        for position, header in zip(header_indexes, headers):
            row[header] = raw.get(position, "")
        if any(str(value).strip() for value in row.values()):
            rows.append(row)
    return rows


def column_index(cell_ref: str) -> int:
    letters = re.match(r"([A-Z]+)", cell_ref or "")
    if not letters:
        return 0
    value = 0
    for char in letters.group(1):
        value = value * 26 + ord(char) - 64
    return value


def cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//main:t", NS))
    value_node = cell.find("main:v", NS)
    if value_node is None or value_node.text is None:
        return ""
    if cell_type == "s":
        index = int(value_node.text)
        return shared_strings[index] if index < len(shared_strings) else ""
    return value_node.text


def split_accepted(value: str, fallback: str) -> list[str]:
    source = value or fallback
    return [item.strip() for item in re.split(r"\s*/\s*|\s*\|\s*", source) if item.strip()]


def sync_answers(payload: dict[str, Any], rows: list[dict[str, str]]) -> int:
    tests = {test.get("id"): test for test in payload.get("tests", [])}
    changed = 0
    for row in rows:
        section = compact_text(row.get("ky_nang")).lower()
        if section not in {"reading", "listening"}:
            continue
        exam_id = compact_text(row.get("ma_de"))
        question = compact_text(row.get("so_cau"))
        if exam_id not in tests or not question.isdigit():
            continue
        answer = compact_text(row.get("dap_an_dung"))
        explanation = str(row.get("giai_thich") or "").strip()
        review_detail = str(row.get("ghi_chu") or "").strip()
        accepted = split_accepted(compact_text(row.get("dap_an_chap_nhan")), answer)
        if not answer and not explanation and not review_detail:
            continue
        answers = tests[exam_id].setdefault(section, {}).setdefault("answers", {})
        current = answers.setdefault(question, {})
        before = json.dumps(current, ensure_ascii=False, sort_keys=True)
        if answer:
            current["answer"] = answer
        if accepted:
            current["accepted"] = accepted
        if explanation:
            current["explanation"] = explanation
        if review_detail:
            current["reviewDetail"] = review_detail
        after = json.dumps(current, ensure_ascii=False, sort_keys=True)
        if before != after:
            changed += 1
    return changed


def sync_writing_images(payload: dict[str, Any], rows: list[dict[str, str]]) -> int:
    tests = {test.get("id"): test for test in payload.get("tests", [])}
    grouped: dict[str, list[tuple[int, str]]] = {}
    for row in rows:
        if compact_text(row.get("ky_nang")).lower() != "writing":
            continue
        exam_id = compact_text(row.get("ma_de"))
        image = compact_text(row.get("anh_neu_co"))
        question = compact_text(row.get("so_cau"))
        if exam_id in tests and image:
            grouped.setdefault(exam_id, []).append((int(question) if question.isdigit() else 99, image))

    changed = 0
    for exam_id, items in grouped.items():
        images = []
        for _, image in sorted(items):
            if image not in images:
                images.append(image)
        writing = tests[exam_id].setdefault("writing", {})
        if images and writing.get("promptImages") != images:
            writing["promptImages"] = images
            changed += 1
    return changed


def sync_raw_lines(payload: dict[str, Any], rows: list[dict[str, str]]) -> int:
    tests = {test.get("id"): test for test in payload.get("tests", [])}
    seen = set()
    changed = 0
    for row in rows:
        if compact_text(row.get("ky_nang")).lower() != "reading":
            continue
        exam_id = compact_text(row.get("ma_de"))
        part_value = compact_text(row.get("part"))
        raw_lines = str(row.get("dong_goc") or "").strip()
        key = (exam_id, part_value)
        if key in seen or exam_id not in tests or not part_value.isdigit() or not raw_lines:
            continue
        seen.add(key)
        part_number = int(part_value)
        part = next(
            (item for item in tests[exam_id].get("reading", {}).get("parts", []) if item.get("number") == part_number),
            None,
        )
        if not part:
            continue
        new_lines = [line.strip() for line in raw_lines.splitlines() if line.strip()]
        if new_lines and part.get("lines") != new_lines:
            part["lines"] = new_lines
            changed += 1
    return changed


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync edited Excel fields into data.js")
    parser.add_argument("xlsx", nargs="?", default=str(DEFAULT_XLSX), help="Excel file to import")
    parser.add_argument("--sync-raw-lines", action="store_true", help="Replace Reading part lines from dong_goc")
    parser.add_argument("--dry-run", action="store_true", help="Validate and report changes without writing data.js")
    args = parser.parse_args()

    xlsx_path = Path(args.xlsx).resolve()
    payload = load_exam_data()
    rows = read_workbook_rows(xlsx_path)
    answer_changes = sync_answers(payload, rows)
    writing_changes = sync_writing_images(payload, rows)
    raw_line_changes = sync_raw_lines(payload, rows) if args.sync_raw_lines else 0

    if not args.dry_run:
        save_exam_data(payload)

    mode = "Checked" if args.dry_run else "Updated"
    print(f"{mode} {DATA_JS}")
    print(f"Rows read: {len(rows)}")
    print(f"Reading/Listening answer/explanation changes: {answer_changes}")
    print(f"Writing image changes: {writing_changes}")
    print(f"Raw Reading part changes: {raw_line_changes}")


if __name__ == "__main__":
    main()
