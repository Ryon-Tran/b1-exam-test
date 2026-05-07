#!/usr/bin/env python3
"""Return exam data with Excel as the live editable source.

The app still keeps data.js as a safe structural fallback because it contains
layout details that are not pleasant to edit by hand in Excel. At runtime this
script reads exam-data-master.xlsx, overlays editable fields, and returns JSON
for the frontend without rewriting data.js.
"""

from __future__ import annotations

import importlib.util
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_XLSX = APP_ROOT / "exports" / "exam-data-master.xlsx"
IMPORT_SCRIPT = APP_ROOT / "scripts" / "import-excel-to-data.py"


def load_import_module():
    spec = importlib.util.spec_from_file_location("import_excel_to_data", IMPORT_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {IMPORT_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


IMPORT = load_import_module()


def compact_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def split_lines(value: str) -> list[str]:
    return [line.strip() for line in str(value or "").splitlines() if line.strip()]


def row_section(row: dict[str, str]) -> str:
    return compact_text(row.get("ky_nang")).lower()


def option_from_cell(letter: str, value: str, current: dict[str, Any] | None = None) -> dict[str, Any] | None:
    value = compact_text(value)
    current = current or {}
    if not value:
        return None

    item: dict[str, Any] = {"letter": letter}
    if re.search(r"\.(png|jpg|jpeg|gif)$", value, re.I):
        item["image"] = value
        if current.get("crop") and current.get("image") == value:
            item["crop"] = current.get("crop")
    else:
        item["text"] = value
    return item


def find_current_question(test: dict[str, Any], part_number: int, question_number: int) -> dict[str, Any]:
    for part in (test.get("listening") or {}).get("parts") or []:
        if int(part.get("number", 0) or 0) != part_number:
            continue
        for question in part.get("questions") or []:
            if int(question.get("number", 0) or 0) == question_number:
                return question
    return {}


def option_lookup(question: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(option.get("letter", "")): option for option in question.get("options") or []}


def sync_listening_content(payload: dict[str, Any], rows: list[dict[str, str]]) -> int:
    tests = {test.get("id"): test for test in payload.get("tests", [])}
    grouped: dict[tuple[str, int], list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        if row_section(row) != "listening":
            continue
        exam_id = compact_text(row.get("ma_de"))
        part_value = compact_text(row.get("part"))
        if exam_id in tests and part_value.isdigit():
            grouped[(exam_id, int(part_value))].append(row)

    changed = 0
    for (exam_id, part_number), part_rows in grouped.items():
        test = tests[exam_id]
        listening = test.setdefault("listening", {})
        parts = listening.setdefault("parts", [])
        current_part = next((item for item in parts if int(item.get("number", 0) or 0) == part_number), {})

        first = part_rows[0]
        new_part = {
            "number": part_number,
            "title": f"Part {part_number}",
            "label": compact_text(first.get("ten_part")) or current_part.get("label") or f"Part {part_number}",
            "instruction": compact_text(first.get("noi_dung_bai_doc")) or current_part.get("instruction", ""),
            "type": current_part.get("type", "choice"),
            "questions": [],
        }
        if current_part.get("intro"):
            new_part["intro"] = current_part["intro"]

        for row in sorted(part_rows, key=lambda item: int(compact_text(item.get("so_cau")) or 0)):
            question_value = compact_text(row.get("so_cau"))
            if not question_value.isdigit():
                continue
            question_number = int(question_value)
            q_type = "text" if "dien" in compact_text(row.get("loai_dap_an")).lower() else "choice"
            current_question = find_current_question(test, part_number, question_number)
            current_options = option_lookup(current_question)

            question: dict[str, Any] = {
                "number": question_number,
                "type": q_type,
                "stem": compact_text(row.get("cau_hoi")) or current_question.get("stem") or f"Câu {question_number}",
            }
            if current_question.get("image"):
                question["image"] = current_question["image"]

            if q_type != "text":
                options = []
                for letter in "ABCDEFGH":
                    option = option_from_cell(letter, row.get(f"lua_chon_{letter}", ""), current_options.get(letter))
                    if option:
                        options.append(option)
                if options:
                    question["options"] = options
            new_part["questions"].append(question)

        before = json.dumps(current_part, ensure_ascii=False, sort_keys=True)
        parts = [part for part in parts if int(part.get("number", 0) or 0) != part_number]
        parts.append(new_part)
        parts.sort(key=lambda item: int(item.get("number", 0) or 0))
        listening["parts"] = parts
        after = json.dumps(new_part, ensure_ascii=False, sort_keys=True)
        if before != after:
            changed += 1

    changed += sync_listening_audio(payload, rows)
    return changed


def sync_listening_audio(payload: dict[str, Any], rows: list[dict[str, str]]) -> int:
    tests = {test.get("id"): test for test in payload.get("tests", [])}
    audio_by_exam: dict[str, dict[int, str]] = defaultdict(dict)
    for row in rows:
        if row_section(row) != "listening":
            continue
        exam_id = compact_text(row.get("ma_de"))
        part_value = compact_text(row.get("part"))
        audio = compact_text(row.get("audio"))
        if exam_id in tests and part_value.isdigit() and audio:
            audio_by_exam[exam_id][int(part_value)] = audio

    changed = 0
    for exam_id, by_part in audio_by_exam.items():
        listening = tests[exam_id].setdefault("listening", {})
        values = [by_part[key] for key in sorted(by_part)]
        new_audio: str | dict[str, str]
        if values and all(value == values[0] for value in values):
            new_audio = values[0]
        else:
            new_audio = {str(key): value for key, value in sorted(by_part.items())}
        if listening.get("audio") != new_audio:
            listening["audio"] = new_audio
            changed += 1
    return changed


def sync_writing_lines(payload: dict[str, Any], rows: list[dict[str, str]]) -> int:
    tests = {test.get("id"): test for test in payload.get("tests", [])}
    changed = 0
    seen: set[str] = set()
    for row in rows:
        if row_section(row) != "writing":
            continue
        exam_id = compact_text(row.get("ma_de"))
        raw_lines = str(row.get("dong_goc") or "").strip()
        if exam_id not in tests or exam_id in seen or not raw_lines:
            continue
        seen.add(exam_id)
        new_lines = split_lines(raw_lines)
        writing = tests[exam_id].setdefault("writing", {})
        if new_lines and writing.get("lines") != new_lines:
            writing["lines"] = new_lines
            changed += 1
    return changed


def build_payload_from_excel(xlsx_path: Path = DEFAULT_XLSX) -> dict[str, Any]:
    payload = IMPORT.load_exam_data()
    if not xlsx_path.exists():
        return {
            "ok": True,
            "source": "data.js fallback",
            "warning": f"Excel file not found: {xlsx_path}",
            "rows": 0,
            "changes": {},
            "data": payload,
        }

    rows = IMPORT.read_workbook_rows(xlsx_path)
    changes = {
        "answers": IMPORT.sync_answers(payload, rows),
        "writingImages": IMPORT.sync_writing_images(payload, rows),
        "readingRawLines": IMPORT.sync_raw_lines(payload, rows),
        "writingLines": sync_writing_lines(payload, rows),
        "listeningContent": sync_listening_content(payload, rows),
    }
    return {
        "ok": True,
        "source": str(xlsx_path),
        "rows": len(rows),
        "changes": changes,
        "data": payload,
    }


def main() -> None:
    print(json.dumps(build_payload_from_excel(), ensure_ascii=False))


if __name__ == "__main__":
    main()
