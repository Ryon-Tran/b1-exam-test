#!/usr/bin/env python3
"""Export exam-app/data.js into editable Excel workbooks.

The project stores exam content in a generated JavaScript file. This script
creates an .xlsx view with one row per question/task so content, images,
answers, and explanations are easier to review in Excel.
"""

from __future__ import annotations

import json
import os
import posixpath
import re
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape


APP_ROOT = Path(__file__).resolve().parents[1]
DATA_JS = APP_ROOT / "data.js"
EXPORT_ROOT = APP_ROOT / "exports"
MASTER_XLSX = EXPORT_ROOT / "exam-data-master.xlsx"
PER_EXAM_ROOT = EXPORT_ROOT / "exams"

PART_RANGES = {
    1: (1, 5),
    2: (6, 10),
    3: (11, 15),
    4: (16, 20),
    5: (21, 26),
    6: (27, 32),
}

LISTENING_PART_RANGES = {
    1: (1, 7),
    2: (8, 13),
    3: (14, 19),
    4: (20, 25),
}

HEADERS = [
    "ma_de",
    "ten_de",
    "file_goc",
    "ky_nang",
    "part",
    "ten_part",
    "khoang_cau",
    "so_cau",
    "dang_cau_hoi",
    "loai_dap_an",
    "tieu_de",
    "noi_dung_bai_doc",
    "cau_hoi",
    "anh_neu_co",
    "audio",
    "lua_chon_A",
    "lua_chon_B",
    "lua_chon_C",
    "lua_chon_D",
    "lua_chon_E",
    "lua_chon_F",
    "lua_chon_G",
    "lua_chon_H",
    "dap_an_dung",
    "dap_an_chap_nhan",
    "giai_thich",
    "dong_goc",
    "ghi_chu",
]


def compact_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def cell_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        value = "\n".join(str(item) for item in value)
    text = str(value)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    return text[:32767]


def load_exam_data() -> dict[str, Any]:
    raw = DATA_JS.read_text(encoding="utf-8-sig").strip()
    raw = re.sub(r"^window\.EXAM_DATA\s*=\s*", "", raw)
    raw = re.sub(r";\s*$", "", raw)
    return json.loads(raw)


def image_by_number(test: dict[str, Any], number: int) -> str:
    question = str(number).zfill(2)
    padded = str(number).zfill(3)
    pattern = re.compile(
        rf"/(reading-part-1-question-{question}|image{number}|exam-asset-{padded})\.(png|jpg|jpeg|gif)$",
        re.I,
    )
    for image in test.get("images") or []:
        if pattern.search(image):
            return image
    return ""


def answer_for(test: dict[str, Any], number: int, section: str = "reading") -> dict[str, Any]:
    return (test.get(section.lower(), {}).get("answers") or {}).get(str(number), {}) or {}


def answer_fields(test: dict[str, Any], number: int, section: str = "reading") -> tuple[str, str, str, str]:
    item = answer_for(test, number, section)
    accepted = item.get("accepted") or []
    if not isinstance(accepted, list):
        accepted = [accepted]
    return (
        cell_text(item.get("answer", "")),
        cell_text(" / ".join(str(value) for value in accepted if value)),
        cell_text(item.get("explanation", "")),
        cell_text(item.get("reviewDetail", "")),
    )


def apply_answer_fields(row: dict[str, str], test: dict[str, Any], number: int, section: str = "reading") -> None:
    answer, accepted, explanation, review_detail = answer_fields(test, number, section)
    row["dap_an_dung"] = answer
    row["dap_an_chap_nhan"] = accepted
    row["giai_thich"] = explanation
    if review_detail:
        row["ghi_chu"] = review_detail


def base_row(test: dict[str, Any], section: str, part: int | str, question: int | str = "") -> dict[str, str]:
    ranges = LISTENING_PART_RANGES if section.lower() == "listening" else PART_RANGES
    if isinstance(part, int) and part in ranges:
        start, end = ranges[part]
        part_name = f"Part {part}"
        question_range = f"{start}-{end}"
    else:
        part_name = str(part)
        question_range = ""

    return {
        "ma_de": cell_text(test.get("id", "")),
        "ten_de": cell_text(test.get("title", "")),
        "file_goc": cell_text(test.get("sourceFile", "")),
        "ky_nang": section,
        "part": cell_text(part),
        "ten_part": part_name,
        "khoang_cau": question_range,
        "so_cau": cell_text(question),
        "dang_cau_hoi": "",
        "loai_dap_an": "",
        "tieu_de": "",
        "noi_dung_bai_doc": "",
        "cau_hoi": "",
        "anh_neu_co": "",
        "audio": "",
        "lua_chon_A": "",
        "lua_chon_B": "",
        "lua_chon_C": "",
        "lua_chon_D": "",
        "lua_chon_E": "",
        "lua_chon_F": "",
        "lua_chon_G": "",
        "lua_chon_H": "",
        "dap_an_dung": "",
        "dap_an_chap_nhan": "",
        "giai_thich": "",
        "dong_goc": "",
        "ghi_chu": "",
    }


def fallback_question_rows(
    test: dict[str, Any],
    part_number: int,
    question_numbers: range,
    raw_lines: str,
    question_type: str,
    answer_type: str,
    note: str,
) -> list[dict[str, str]]:
    rows = []
    for number in question_numbers:
        row = base_row(test, "Reading", part_number, number)
        row["dang_cau_hoi"] = question_type
        row["loai_dap_an"] = answer_type
        row["noi_dung_bai_doc"] = raw_lines
        row["cau_hoi"] = f"Question {number} needs manual cleanup in data.js."
        apply_answer_fields(row, test, number)
        row["dong_goc"] = raw_lines
        row["ghi_chu"] = note
        rows.append(row)
    return rows


def cleaned_part_lines(lines: list[str]) -> list[str]:
    result = []
    for line in lines:
        line = re.sub(r"^-?\d+(\s+-?\d+){1,}\s+", "", str(line or ""))
        line = compact_text(line)
        if line:
            result.append(line)
    return result


def is_instruction_line(line: str) -> bool:
    patterns = [
        r"^part\s+\d+",
        r"^questions\s+",
        r"^look at",
        r"^the people below",
        r"^on the opposite page",
        r"^decide which",
        r"^read the text",
        r"^for each question",
        r"^for questions",
        r"^for\s+\d+[-–]\d+",
        r"^five sentences have been removed",
        r"^there are three extra sentences",
        r"^write one word",
    ]
    return any(re.search(pattern, line, re.I) for pattern in patterns)


def parse_lettered_choices(text: str, letters: list[str]) -> list[dict[str, str]]:
    letters_pattern = "".join(letters)
    pattern = re.compile(
        rf"(?:^|\s)([{letters_pattern}])\s*\.?\s+([\s\S]*?)(?=(?:\s+[{letters_pattern}]\s*\.?\s+)|$)"
    )
    return [
        {"letter": match.group(1), "text": compact_text(match.group(2))}
        for match in pattern.finditer(compact_text(text))
    ]


def fill_options(row: dict[str, str], options: list[dict[str, str]], title_key: str = "text") -> None:
    for option in options:
        letter = option.get("letter", "")
        if letter not in "ABCDEFGH":
            continue
        text = option.get(title_key, "") or option.get("image", "")
        if title_key == "title":
            detail = option.get("detail", "")
            text = f"{text} - {detail}" if detail else text
        row[f"lua_chon_{letter}"] = cell_text(text)


def parse_part_one_questions(lines: list[str]) -> list[dict[str, Any]]:
    questions: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    current_option: dict[str, str] | None = None

    for index, line in enumerate(lines):
        question_match = re.match(r"^(\d+)\s*\.?$", line)
        if question_match:
            current = {"number": int(question_match.group(1)), "promptLines": [], "options": []}
            current_option = None
            questions.append(current)
            continue
        if not current:
            continue

        option_match = re.match(r"^([A-C])(?:$|\s*\.?\s+)(.*)$", line)
        next_line = lines[index + 1] if index + 1 < len(lines) else ""
        if option_match and is_part_one_option_line(line, next_line, current_option):
            current_option = {"letter": option_match.group(1), "text": option_match.group(2).strip()}
            current["options"].append(current_option)
            continue

        if current_option:
            current_option["text"] = compact_text(f"{current_option['text']} {line}")
        elif not re.search(r"^Part\s+1$|^Questions\s+|^Look at|^For each", line, re.I):
            current["promptLines"].append(line)

    return questions


def is_part_one_option_line(line: str, next_line: str, current_option: dict[str, str] | None) -> bool:
    if re.match(r"^[A-C]\s*\.?$", line):
        return True
    if re.match(r"^[A-C]\s*\.\s+", line):
        return True
    if current_option:
        return True
    return bool(re.match(r"^A\s+", line) and re.match(r"^B(?:$|\s*\.?\s+)", next_line))


def parse_part_two(lines: list[str]) -> dict[str, Any]:
    cleaned = [compact_text(re.sub(r"^-?\d+(\s+-?\d+){1,}\s+", "", line)) for line in lines]
    cleaned = [line for line in cleaned if line]
    question_indexes = [
        index for index, line in enumerate(cleaned) if re.match(r"^([6-9]|10)\s*\.?$", line)
    ]
    first_question_index = question_indexes[0] if question_indexes else len(cleaned)
    intro = [
        line
        for line in cleaned[:first_question_index]
        if not re.search(r"^Part\s+2|^Questions\s+6", line, re.I)
    ]
    questions = []

    for idx, start_index in enumerate(question_indexes):
        next_index = question_indexes[idx + 1] if idx + 1 < len(question_indexes) else None
        number = int(re.search(r"\d+", cleaned[start_index]).group(0))
        end_index = next_index if next_index is not None else find_part_two_option_start(cleaned, start_index + 1)
        if not end_index or end_index <= start_index:
            end_index = len(cleaned)
        questions.append({"number": number, "text": " ".join(cleaned[start_index + 1 : end_index])})

    option_start = find_part_two_option_start(cleaned, (question_indexes[-1] + 1) if question_indexes else 0)
    option_title = cleaned[option_start] if 0 <= option_start < len(cleaned) else "Options"
    options = parse_part_two_options(cleaned[option_start + 1 :])
    return {"intro": intro, "questions": questions, "optionTitle": option_title, "options": options}


def find_part_two_option_start(lines: list[str], from_index: int) -> int:
    for index in range(max(0, from_index), len(lines)):
        line = lines[index]
        previous = lines[index - 1] if index > 0 else ""
        looks_like_title = len(line) < 80 and not re.search(r"[.!?]$", line)
        previous_was_question_text = len(previous) > 20 and bool(re.search(r"[.!?]$", previous))
        next_looks_like_option = bool(re.match(r"^([A-H])\s*\.?\s+", lines[index + 1] if index + 1 < len(lines) else ""))
        if next_looks_like_option:
            return index
        if previous_was_question_text and looks_like_title:
            return index
    return from_index + 1


def parse_part_two_options(lines: list[str]) -> list[dict[str, str]]:
    options = []
    current = None
    used_letters = set()

    for line in lines:
        match = re.match(r"^([A-H])\s*\.?\s+(.+)$", line)
        if match:
            current = {"letter": match.group(1), "title": match.group(2).strip(), "detailLines": []}
            used_letters.add(current["letter"])
            options.append(current)
            continue
        if not current:
            current = {"letter": next_missing_letter(used_letters), "title": line, "detailLines": []}
            used_letters.add(current["letter"])
            options.append(current)
            continue
        current["detailLines"].append(line)

    return [
        {"letter": item["letter"], "title": item["title"], "detail": " ".join(item["detailLines"])}
        for item in options
    ]


def next_missing_letter(used_letters: set[str]) -> str:
    for letter in "ABCDEFGH":
        if letter not in used_letters:
            return letter
    return "A"


def parse_reading_mcq_part(lines: list[str], start: int, end: int) -> dict[str, Any] | None:
    cleaned = cleaned_part_lines(lines)
    first_question_index = find_first_question_index(cleaned, start, end)
    if first_question_index < 0:
        return None
    prelude = [line for line in cleaned[:first_question_index] if not is_instruction_line(line)]
    title = prelude[0] if prelude else f"Questions {start}-{end}"
    passage = prelude[1:]
    questions = parse_mcq_questions(" ".join(cleaned[first_question_index:]), start, end, list("ABCD"))
    if len(questions) != end - start + 1:
        return None
    return {"title": title, "passage": passage, "questions": questions}


def parse_mcq_questions(text: str, start: int, end: int, letters: list[str]) -> list[dict[str, Any]]:
    question_numbers = [str(number) for number in range(start, end + 1)]
    pattern = re.compile(rf"(?:^|\s)({'|'.join(question_numbers)})\s*\.?\s*")
    source = compact_text(text)
    starts = []
    for match in pattern.finditer(source):
        starts.append({"number": int(match.group(1)), "bodyStart": match.end(), "matchStart": match.start()})

    questions = []
    for idx, item in enumerate(starts):
        next_start = starts[idx + 1]["matchStart"] if idx + 1 < len(starts) else len(source)
        questions.append(parse_mcq_question_body(source[item["bodyStart"] : next_start], item["number"], letters))
    return questions


def parse_mcq_question_body(body: str, number: int, letters: list[str]) -> dict[str, Any]:
    cleaned_body = re.sub(r"^\.\s*", "", compact_text(body))
    options = parse_lettered_choices(cleaned_body, letters)
    first_option = re.search(rf"(?:^|\s){letters[0]}\s*\.?\s+", cleaned_body)
    stem = cleaned_body[: first_option.start()].strip() if first_option else cleaned_body
    return {"number": number, "stem": stem, "options": options}


def find_first_question_index(lines: list[str], start: int, end: int) -> int:
    for index, line in enumerate(lines):
        if any(re.match(rf"^{number}\s*\.?\s*", line) for number in range(start, end + 1)):
            return index
    return -1


def parse_part_four(lines: list[str]) -> dict[str, Any] | None:
    cleaned = [line for line in cleaned_part_lines(lines) if not is_instruction_line(line)]
    if not cleaned:
        return None
    option_start = find_part_four_option_start(cleaned)
    if option_start <= 0:
        return None
    title = cleaned[0]
    passage = cleaned[1:option_start]
    options = parse_part_four_options(cleaned[option_start:])
    if not passage or len(options) < 5:
        return None
    return {"title": title, "passage": passage, "options": options}


def find_part_four_option_start(lines: list[str]) -> int:
    for index, line in enumerate(lines):
        if index > 0 and re.match(r"^[A-H]\.?$", line):
            return index
    for index, line in enumerate(lines):
        if index > 0 and looks_like_option_line(line):
            return index
    return len(lines) - 8 if len(lines) > 9 else -1


def looks_like_option_line(line: str) -> bool:
    if re.match(r"^[A-H]\s*\.?\s+", line):
        return True
    return len(re.findall(r"\b[A-H]\s*\.?\s+", line)) >= 3


def parse_part_four_options(lines: list[str]) -> list[dict[str, str]]:
    labelled = parse_lettered_choices(" ".join(lines), list("ABCDEFGH"))
    if len(labelled) >= 5:
        return labelled
    return [{"letter": letter, "text": line} for letter, line in zip("ABCDEFGH", lines[:8])]


def parse_part_six(lines: list[str]) -> dict[str, Any]:
    cleaned = [line for line in cleaned_part_lines(lines) if not is_instruction_line(line)]
    title = cleaned[0] if cleaned else "Questions 27-32"
    passage = "\n".join(cleaned[1:]) if len(cleaned) > 1 else "\n".join(cleaned)
    return {"title": title, "passage": passage}


def extract_writing_tasks(lines: list[str], prompt_images: list[str]) -> list[dict[str, str]]:
    cleaned = [compact_text(line) for line in lines if compact_text(line)]
    markers = []
    for index, line in enumerate(cleaned):
        match = re.match(r"^Question\s+([123])\b", line, re.I)
        if match:
            markers.append((int(match.group(1)), index))

    tasks = []
    for idx, (number, start_index) in enumerate(markers):
        end_index = markers[idx + 1][1] if idx + 1 < len(markers) else len(cleaned)
        block = cleaned[start_index:end_index]
        task_type = "Writing task"
        if number == 1:
            task_type = "Writing Part 1 - email"
        elif any(re.search(r"\barticle\b", line, re.I) for line in block):
            task_type = "Writing Part 2 - article"
        elif any(re.search(r"\bstory\b", line, re.I) for line in block):
            task_type = "Writing Part 2 - story"
        image = prompt_images[0] if number == 1 and prompt_images else ""
        if number == 2 and len(prompt_images) > 1:
            image = prompt_images[1]
        tasks.append({"number": number, "type": task_type, "text": "\n".join(block), "image": image})
    return tasks


def build_listening_rows(test: dict[str, Any]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    listening = test.get("listening") or {}
    for part in listening.get("parts") or []:
        part_number = int(part.get("number", 0) or 0)
        questions = part.get("questions") or []
        part_title = compact_text(part.get("label") or part.get("title") or f"Part {part_number}")
        context = "\n".join(
            item
            for item in [
                compact_text(part.get("instruction", "")),
                compact_text(part.get("intro", "")),
            ]
            if item
        )
        for question in questions:
            number = int(question.get("number", 0) or 0)
            if not number:
                continue
            q_type = compact_text(question.get("type") or part.get("type") or "choice")
            options = question.get("options") or []
            image_options = [
                f"{option.get('letter')}: {option.get('image')}"
                for option in options
                if option.get("image")
            ]

            row = base_row(test, "Listening", part_number, number)
            row["ten_part"] = part_title
            row["dang_cau_hoi"] = f"Listening Part {part_number} - {q_type}"
            row["loai_dap_an"] = "dien_tu_hoac_so" if q_type == "text" else "chon_1_trong_3"
            row["tieu_de"] = part_title
            row["noi_dung_bai_doc"] = context
            row["cau_hoi"] = compact_text(question.get("stem") or question.get("question") or "")
            row["anh_neu_co"] = "\n".join(image_options)
            row["audio"] = listening_audio_for_part(listening.get("audio"), part_number)
            fill_options(row, options)
            apply_answer_fields(row, test, number, "listening")
            row["dong_goc"] = context
            rows.append(row)
    return rows


def listening_audio_for_part(audio: Any, part_number: int) -> str:
    if isinstance(audio, str):
        return audio
    if isinstance(audio, dict):
        return cell_text(
            audio.get(str(part_number))
            or audio.get(f"part{part_number}")
            or audio.get(f"part-{part_number}")
            or ""
        )
    if isinstance(audio, list):
        return cell_text(audio[part_number - 1] if part_number - 1 < len(audio) else "")
    return ""


def build_exam_rows(test: dict[str, Any]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []

    for part in test.get("reading", {}).get("parts") or []:
        part_number = int(part.get("number", 0) or 0)
        lines = [str(line) for line in (part.get("lines") or [])]
        raw_lines = "\n".join(lines)

        if part_number == 1:
            parsed_questions = parse_part_one_questions(lines)
            for question in parsed_questions:
                number = int(question["number"])
                row = base_row(test, "Reading", part_number, number)
                row["dang_cau_hoi"] = "Reading Part 1 - multiple choice"
                row["loai_dap_an"] = "chon_1_trong_3"
                row["cau_hoi"] = "\n".join(question.get("promptLines") or [])
                row["anh_neu_co"] = image_by_number(test, number)
                fill_options(row, question.get("options") or [])
                apply_answer_fields(row, test, number)
                row["dong_goc"] = raw_lines
                rows.append(row)
            missing = sorted(set(range(1, 6)) - {int(question["number"]) for question in parsed_questions})
            if missing:
                rows.extend(
                    fallback_question_rows(
                        test,
                        part_number,
                        range(missing[0], missing[-1] + 1),
                        raw_lines,
                        "Reading Part 1 - multiple choice",
                        "chon_1_trong_3",
                        "Part 1 parse thiếu câu; kiểm tra lại dòng gốc.",
                    )
                )
            continue

        if part_number == 2:
            parsed = parse_part_two(lines)
            context = "\n".join(parsed.get("intro") or [])
            option_bank = parsed.get("options") or []
            for question in parsed.get("questions") or []:
                number = int(question["number"])
                row = base_row(test, "Reading", part_number, number)
                row["dang_cau_hoi"] = "Reading Part 2 - matching"
                row["loai_dap_an"] = "chon_1_trong_8"
                row["tieu_de"] = parsed.get("optionTitle", "")
                row["noi_dung_bai_doc"] = context
                row["cau_hoi"] = question.get("text", "")
                fill_options(row, option_bank, title_key="title")
                apply_answer_fields(row, test, number)
                row["dong_goc"] = raw_lines
                rows.append(row)
            missing = sorted(set(range(6, 11)) - {int(question["number"]) for question in parsed.get("questions") or []})
            if missing:
                rows.extend(
                    fallback_question_rows(
                        test,
                        part_number,
                        range(missing[0], missing[-1] + 1),
                        raw_lines,
                        "Reading Part 2 - matching",
                        "chon_1_trong_8",
                        "Part 2 parse thiếu câu; kiểm tra lại dòng gốc.",
                    )
                )
            continue

        if part_number == 3:
            parsed = parse_reading_mcq_part(lines, 11, 15)
            if parsed:
                for question in parsed["questions"]:
                    number = int(question["number"])
                    row = base_row(test, "Reading", part_number, number)
                    row["dang_cau_hoi"] = "Reading Part 3 - multiple choice"
                    row["loai_dap_an"] = "chon_1_trong_4"
                    row["tieu_de"] = parsed["title"]
                    row["noi_dung_bai_doc"] = "\n".join(parsed["passage"])
                    row["cau_hoi"] = question.get("stem", "")
                    fill_options(row, question.get("options") or [])
                    apply_answer_fields(row, test, number)
                    row["dong_goc"] = raw_lines
                    rows.append(row)
                continue
            rows.extend(
                fallback_question_rows(
                    test,
                    part_number,
                    range(11, 16),
                    raw_lines,
                    "Reading Part 3 - multiple choice",
                    "chon_1_trong_4",
                    "Part 3 chưa parse đủ câu; dùng dòng gốc để sửa thủ công.",
                )
            )
            continue

        if part_number == 4:
            parsed = parse_part_four(lines)
            if parsed:
                option_bank = parsed.get("options") or []
                for number in range(16, 21):
                    row = base_row(test, "Reading", part_number, number)
                    row["dang_cau_hoi"] = "Reading Part 4 - gapped text"
                    row["loai_dap_an"] = "chon_1_trong_8"
                    row["tieu_de"] = parsed["title"]
                    row["noi_dung_bai_doc"] = "\n".join(parsed["passage"])
                    row["cau_hoi"] = f"Choose the sentence that fits gap {number}."
                    fill_options(row, option_bank)
                    apply_answer_fields(row, test, number)
                    row["dong_goc"] = raw_lines
                    rows.append(row)
                continue
            rows.extend(
                fallback_question_rows(
                    test,
                    part_number,
                    range(16, 21),
                    raw_lines,
                    "Reading Part 4 - gapped text",
                    "chon_1_trong_8",
                    "Part 4 chưa parse đủ câu; dùng dòng gốc để sửa thủ công.",
                )
            )
            continue

        if part_number == 5:
            parsed = parse_reading_mcq_part(lines, 21, 26)
            if parsed:
                for question in parsed["questions"]:
                    number = int(question["number"])
                    row = base_row(test, "Reading", part_number, number)
                    row["dang_cau_hoi"] = "Reading Part 5 - multiple-choice cloze"
                    row["loai_dap_an"] = "chon_1_trong_4"
                    row["tieu_de"] = parsed["title"]
                    row["noi_dung_bai_doc"] = "\n".join(parsed["passage"])
                    row["cau_hoi"] = question.get("stem", "")
                    fill_options(row, question.get("options") or [])
                    apply_answer_fields(row, test, number)
                    row["dong_goc"] = raw_lines
                    rows.append(row)
                continue
            rows.extend(
                fallback_question_rows(
                    test,
                    part_number,
                    range(21, 27),
                    raw_lines,
                    "Reading Part 5 - multiple-choice cloze",
                    "chon_1_trong_4",
                    "Part 5 chưa parse đủ câu; dùng dòng gốc để sửa thủ công.",
                )
            )
            continue

        if part_number == 6:
            parsed = parse_part_six(lines)
            for number in range(27, 33):
                row = base_row(test, "Reading", part_number, number)
                row["dang_cau_hoi"] = "Reading Part 6 - open cloze"
                row["loai_dap_an"] = "dien_1_tu"
                row["tieu_de"] = parsed["title"]
                row["noi_dung_bai_doc"] = parsed["passage"]
                row["cau_hoi"] = f"Write one word for gap {number}."
                apply_answer_fields(row, test, number)
                row["dong_goc"] = raw_lines
                rows.append(row)
            continue

        row = base_row(test, "Reading", part_number)
        row["dang_cau_hoi"] = "Raw reading part"
        row["dong_goc"] = raw_lines
        row["ghi_chu"] = "Part này chưa parse được thành từng câu."
        rows.append(row)

    writing = test.get("writing") or {}
    for task in extract_writing_tasks(writing.get("lines") or [], writing.get("promptImages") or []):
        row = base_row(test, "Writing", "Writing", task["number"])
        row["ten_part"] = "Writing"
        row["dang_cau_hoi"] = task["type"]
        row["loai_dap_an"] = "viet_tu_luan_100_tu"
        row["cau_hoi"] = task["text"]
        row["anh_neu_co"] = task["image"]
        row["dong_goc"] = "\n".join(writing.get("lines") or [])
        rows.append(row)

    rows.extend(build_listening_rows(test))

    return rows


def build_image_rows(tests: list[dict[str, Any]], question_rows: list[dict[str, str]]) -> list[dict[str, str]]:
    used = {}
    for row in question_rows:
        for image in image_paths_from_cell(row.get("anh_neu_co", "")):
            used.setdefault(image, []).append(
                f"{row.get('ma_de')} {row.get('ky_nang')} {row.get('ten_part')} cau {row.get('so_cau')}"
            )

    rows = []
    for test in tests:
        for image in test.get("images") or []:
            match = re.search(r"(?:image|exam-asset|source-asset)-?(\d+)\.", image, re.I)
            if not match:
                match = re.search(r"reading-part-1-question-(\d+)\.", image, re.I)
            if not match:
                match = re.search(r"listening-part-\d+-question-(\d+)-option-([a-z])\.", image, re.I)
            local_path = APP_ROOT / Path(*image.split("/"))
            rows.append(
                {
                    "ma_de": cell_text(test.get("id", "")),
                    "ten_de": cell_text(test.get("title", "")),
                    "so_anh": "-".join(match.groups()) if match else "",
                    "duong_dan_anh": image,
                    "dang_duoc_dung_o": "\n".join(used.get(image, [])),
                    "ton_tai_file": "yes" if local_path.exists() else "no",
                }
            )
    return rows


def image_paths_from_cell(value: str) -> list[str]:
    paths = []
    for line in str(value or "").splitlines():
        candidate = compact_text(line)
        candidate = re.sub(r"^[A-H]\s*:\s*", "", candidate)
        if candidate and re.search(r"\.(png|jpg|jpeg|gif)$", candidate, re.I):
            paths.append(candidate)
    return paths


def write_xlsx(path: Path, sheets: list[tuple[str, list[dict[str, Any]], list[str]]]) -> Path:
    try:
        write_xlsx_file(path, sheets)
        return path
    except PermissionError:
        fallback = timestamped_path(path)
        write_xlsx_file(fallback, sheets)
        return fallback


def timestamped_path(path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    candidate = path.with_name(f"{path.stem}-{stamp}{path.suffix}")
    counter = 2
    while candidate.exists():
        candidate = path.with_name(f"{path.stem}-{stamp}-{counter}{path.suffix}")
        counter += 1
    return candidate


def write_xlsx_file(path: Path, sheets: list[tuple[str, list[dict[str, Any]], list[str]]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as xlsx:
        xlsx.writestr("[Content_Types].xml", content_types_xml(len(sheets)))
        xlsx.writestr("_rels/.rels", root_rels_xml())
        xlsx.writestr("xl/workbook.xml", workbook_xml(sheets))
        xlsx.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml(len(sheets)))
        xlsx.writestr("xl/styles.xml", styles_xml())
        for index, (_, rows, headers) in enumerate(sheets, start=1):
            xlsx.writestr(f"xl/worksheets/sheet{index}.xml", worksheet_xml(rows, headers))


def safe_sheet_name(name: str, used: set[str]) -> str:
    cleaned = re.sub(r"[\[\]\:\*\?\/\\]", "_", name)[:31] or "Sheet"
    candidate = cleaned
    suffix = 1
    while candidate.lower() in used:
        tail = f"_{suffix}"
        candidate = f"{cleaned[:31 - len(tail)]}{tail}"
        suffix += 1
    used.add(candidate.lower())
    return candidate


def column_letter(number: int) -> str:
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def worksheet_xml(rows: list[dict[str, Any]], headers: list[str]) -> str:
    max_row = max(len(rows) + 1, 1)
    max_col = max(len(headers), 1)
    dimension = f"A1:{column_letter(max_col)}{max_row}"
    body = [row_xml(1, headers, headers, is_header=True)]
    for row_index, row in enumerate(rows, start=2):
        body.append(row_xml(row_index, [row.get(header, "") for header in headers], headers))

    col_defs = "".join(
        f'<col min="{index}" max="{index}" width="{column_width(header)}" customWidth="1"/>'
        for index, header in enumerate(headers, start=1)
    )
    auto_filter = f'<autoFilter ref="A1:{column_letter(max_col)}{max_row}"/>' if rows else ""
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<dimension ref="{dimension}"/>'
        '<sheetViews><sheetView workbookViewId="0">'
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
        '<selection pane="bottomLeft"/>'
        '</sheetView></sheetViews>'
        f"<cols>{col_defs}</cols>"
        '<sheetData>'
        f'{"".join(body)}'
        '</sheetData>'
        f"{auto_filter}"
        '</worksheet>'
    )


def column_width(header: str) -> int:
    widths = {
        "noi_dung_bai_doc": 55,
        "cau_hoi": 48,
        "anh_neu_co": 35,
        "giai_thich": 55,
        "dong_goc": 45,
        "ghi_chu": 35,
        "duong_dan_anh": 40,
        "dang_duoc_dung_o": 45,
    }
    if header.startswith("lua_chon_"):
        return 35
    return widths.get(header, 18)


def row_xml(row_index: int, values: list[Any], headers: list[str], is_header: bool = False) -> str:
    style = "1" if is_header else "2"
    cells = []
    for col_index, value in enumerate(values, start=1):
        ref = f"{column_letter(col_index)}{row_index}"
        text = escape(cell_text(value), {'"': "&quot;"})
        cells.append(
            f'<c r="{ref}" t="inlineStr" s="{style}">'
            f'<is><t xml:space="preserve">{text}</t></is>'
            '</c>'
        )
    return f'<row r="{row_index}">{"".join(cells)}</row>'


def content_types_xml(sheet_count: int) -> str:
    sheet_overrides = "".join(
        f'<Override PartName="/xl/worksheets/sheet{index}.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for index in range(1, sheet_count + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        f"{sheet_overrides}"
        '</Types>'
    )


def root_rels_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        '</Relationships>'
    )


def workbook_xml(sheets: list[tuple[str, list[dict[str, Any]], list[str]]]) -> str:
    used = set()
    sheet_xml = []
    for index, (name, _, _) in enumerate(sheets, start=1):
        safe_name = escape(safe_sheet_name(name, used), {'"': "&quot;"})
        sheet_xml.append(f'<sheet name="{safe_name}" sheetId="{index}" r:id="rId{index}"/>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<bookViews><workbookView/></bookViews>'
        f'<sheets>{"".join(sheet_xml)}</sheets>'
        '</workbook>'
    )


def workbook_rels_xml(sheet_count: int) -> str:
    rels = []
    for index in range(1, sheet_count + 1):
        rels.append(
            f'<Relationship Id="rId{index}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            f'Target="worksheets/sheet{index}.xml"/>'
        )
    rels.append(
        f'<Relationship Id="rId{sheet_count + 1}" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'{"".join(rels)}'
        '</Relationships>'
    )


def styles_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2">'
        '<font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
        '</fonts>'
        '<fills count="3">'
        '<fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FF14543B"/><bgColor indexed="64"/></patternFill></fill>'
        '</fills>'
        '<borders count="2">'
        '<border><left/><right/><top/><bottom/><diagonal/></border>'
        '<border><left style="thin"><color rgb="FFD8DED5"/></left><right style="thin"><color rgb="FFD8DED5"/></right>'
        '<top style="thin"><color rgb="FFD8DED5"/></top><bottom style="thin"><color rgb="FFD8DED5"/></bottom><diagonal/></border>'
        '</borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="3">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1">'
        '<alignment vertical="center" wrapText="1"/></xf>'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1">'
        '<alignment vertical="top" wrapText="1"/></xf>'
        '</cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        '</styleSheet>'
    )


def slug_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_")
    return cleaned or "exam"


def main() -> None:
    payload = load_exam_data()
    tests = payload.get("tests") or []
    question_rows = []
    rows_by_exam = {}

    for test in tests:
        rows = build_exam_rows(test)
        rows_by_exam[test.get("id", "")] = rows
        question_rows.extend(rows)

    image_headers = ["ma_de", "ten_de", "so_anh", "duong_dan_anh", "dang_duoc_dung_o", "ton_tai_file"]
    image_rows = build_image_rows(tests, question_rows)
    meta_headers = ["key", "value"]
    meta_rows = [
        {"key": "generated_at", "value": datetime.now().isoformat(timespec="seconds")},
        {"key": "source", "value": str(DATA_JS)},
        {"key": "tests", "value": str(len(tests))},
        {"key": "question_task_rows", "value": str(len(question_rows))},
    ]

    master_sheets = [("tat_ca_cau", question_rows, HEADERS)]
    master_sheets.extend((test.get("id", "de"), rows_by_exam.get(test.get("id", ""), []), HEADERS) for test in tests)
    master_sheets.extend([("anh", image_rows, image_headers), ("meta", meta_rows, meta_headers)])
    master_path = write_xlsx(MASTER_XLSX, master_sheets)

    PER_EXAM_ROOT.mkdir(parents=True, exist_ok=True)
    exam_paths = []
    for test in tests:
        exam_id = test.get("id", "exam")
        rows = rows_by_exam.get(exam_id, [])
        test_images = [row for row in image_rows if row["ma_de"] == exam_id]
        out_path = PER_EXAM_ROOT / f"{slug_filename(exam_id)}.xlsx"
        exam_paths.append(
            write_xlsx(
                out_path,
                [
                    ("cau_hoi", rows, HEADERS),
                    ("anh", test_images, image_headers),
                    ("meta", [{"key": "source_file", "value": test.get("sourceFile", "")}], meta_headers),
                ],
            )
        )

    print(f"Wrote {master_path}")
    print(f"Wrote {len(exam_paths)} per-exam workbooks to {PER_EXAM_ROOT}")


if __name__ == "__main__":
    main()
