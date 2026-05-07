#!/usr/bin/env python3
"""Grade B1 writing answers with a short Gemini/OpenAI prompt.

Input is a JSON object on stdin:
{"task":"...","answer":"...","label":"Question 1 - Email","examTitle":"ĐỀ ÔN 1"}
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parents[1]
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/{model}:generateContent"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite"
MAX_PROMPT_CHARS = 2400
MAX_ANSWER_CHARS = 1800
PRACTICE_CURVE_MIN_WORDS = 45
SEVERE_FLAGS = {"empty", "too_short", "off_topic", "not_english"}
PLACEHOLDER_VALUES = {
    "your_api_key_here",
    "your_google_ai_studio_key_here",
    "your_openai_api_key_here",
}


def compact_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def parse_env_lines(text: str, config: dict[str, str]) -> None:
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        if value:
            config[key.strip()] = value


def local_config() -> dict[str, str]:
    config: dict[str, str] = {}
    for file_name in ["api-key.txt", "gemini-api-key.txt", "google-api-key.txt", "openai-api-key.txt", ".env"]:
        path = APP_ROOT / file_name
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8-sig").strip()
        if file_name == ".env" or "=" in text:
            parse_env_lines(text, config)
        elif text and file_name in ["gemini-api-key.txt", "google-api-key.txt"]:
            config["GEMINI_API_KEY"] = text
        elif text:
            config["OPENAI_API_KEY"] = text
    return config


def read_setting(name: str, config: dict[str, str], default: str = "") -> str:
    value = os.environ.get(name, config.get(name, default)).strip()
    if value in PLACEHOLDER_VALUES:
        return ""
    return value


def provider_config() -> tuple[str, str, str]:
    config = local_config()
    google_key = (
        read_setting("GEMINI_API_KEY", config)
        or read_setting("GOOGLE_API_KEY", config)
        or read_setting("GOOGLE_AI_API_KEY", config)
    )
    if google_key:
        model = read_setting("GEMINI_WRITING_MODEL", config) or read_setting("GOOGLE_WRITING_MODEL", config)
        return "gemini", google_key, model or DEFAULT_GEMINI_MODEL

    openai_key = read_setting("OPENAI_API_KEY", config)
    if openai_key:
        model = read_setting("OPENAI_WRITING_MODEL", config) or DEFAULT_OPENAI_MODEL
        return "openai", openai_key, model

    return "", "", ""


def build_prompt(payload: dict[str, Any]) -> str:
    task = compact_text(payload.get("task"))[:MAX_PROMPT_CHARS]
    answer = compact_text(payload.get("answer"))[:MAX_ANSWER_CHARS]
    label = compact_text(payload.get("label"))
    exam_title = compact_text(payload.get("examTitle"))
    return (
        "Use lenient B1 practice scoring, not a harsh IELTS-style standard. "
        "Rubric 0-5 each: TA=task achievement; ORG=organisation; "
        "VOC=B1 vocabulary; GRA=B1 grammar. Default to 3/5 when the answer "
        "is on topic and mostly understandable. Give 4/5 for clear B1 work "
        "with some mistakes. Minor spelling/grammar errors are normal at B1. "
        "Do not require advanced vocabulary or complex grammar. Penalize hard "
        "only for empty, too short, off topic, missing format, or not English. "
        "Level: 0-8=A2, 9-12=B1-, 13-16=B1, 17-20=B1+. "
        "Grade only; do not rewrite the full answer. Vietnamese note max 18 words. "
        "Vietnamese suggestion max 35 words with 1-2 practical edits the learner should make. "
        f"Exam: {exam_title}. Task label: {label}. Task: {task}. "
        f"Student answer: {answer}"
    )


def grade_schema() -> dict[str, Any]:
    return {
        "name": "b1_writing_score",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "ta": {"type": "integer", "minimum": 0, "maximum": 5},
                "org": {"type": "integer", "minimum": 0, "maximum": 5},
                "voc": {"type": "integer", "minimum": 0, "maximum": 5},
                "gra": {"type": "integer", "minimum": 0, "maximum": 5},
                "total": {"type": "integer", "minimum": 0, "maximum": 20},
                "level": {"type": "string", "enum": ["A2", "B1-", "B1", "B1+"]},
                "note": {"type": "string"},
                "suggestion": {"type": "string"},
                "flags": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["too_short", "off_topic", "missing_format", "not_english", "empty", "limited_prompt"],
                    },
                },
            },
            "required": ["ta", "org", "voc", "gra", "total", "level", "note", "suggestion", "flags"],
        },
    }


def gemini_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "propertyOrdering": ["ta", "org", "voc", "gra", "total", "level", "note", "suggestion", "flags"],
        "properties": {
            "ta": {"type": "integer", "minimum": 0, "maximum": 5},
            "org": {"type": "integer", "minimum": 0, "maximum": 5},
            "voc": {"type": "integer", "minimum": 0, "maximum": 5},
            "gra": {"type": "integer", "minimum": 0, "maximum": 5},
            "total": {"type": "integer", "minimum": 0, "maximum": 20},
            "level": {"type": "string", "enum": ["A2", "B1-", "B1", "B1+"]},
            "note": {"type": "string"},
            "suggestion": {"type": "string"},
            "flags": {
                "type": "array",
                "items": {
                    "type": "string",
                    "enum": ["too_short", "off_topic", "missing_format", "not_english", "empty", "limited_prompt"],
                },
            },
        },
        "required": ["ta", "org", "voc", "gra", "total", "level", "note", "suggestion", "flags"],
    }


def openai_payload(model: str, user_prompt: str, use_schema: bool = True) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "temperature": 0,
        "max_completion_tokens": 220,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a B1 English writing examiner. "
                    "Return only compact valid JSON."
                ),
            },
            {"role": "user", "content": user_prompt},
        ],
    }
    if use_schema:
        payload["response_format"] = {"type": "json_schema", "json_schema": grade_schema()}
    else:
        payload["response_format"] = {"type": "json_object"}
    return payload


def gemini_payload(user_prompt: str, use_schema: bool = True) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "systemInstruction": {
            "parts": [
                {
                    "text": (
                        "You are a B1 English writing examiner. "
                        "Return only compact valid JSON."
                    )
                }
            ]
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 220,
            "responseMimeType": "application/json",
        },
    }
    if use_schema:
        payload["generationConfig"]["responseJsonSchema"] = gemini_schema()
    return payload


def call_openai(api_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        OPENAI_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def call_gemini(api_key: str, model: str, payload: dict[str, Any]) -> dict[str, Any]:
    model_path = model if model.startswith("models/") else f"models/{model}"
    url = GEMINI_URL.format(model=model_path)
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def format_http_error(provider: str, status: int, body: str) -> str:
    provider_name = "Gemini" if provider == "gemini" else "OpenAI"
    message = body
    try:
        message = json.loads(body).get("error", {}).get("message") or body
    except json.JSONDecodeError:
        pass

    if status == 429:
        return (
            f"{provider_name} đang báo hết quota hoặc bị giới hạn tần suất. "
            "Hãy kiểm tra quota/billing của Google AI Studio rồi thử lại sau."
        )
    if status in {401, 403}:
        return f"{provider_name} từ chối API key. Hãy kiểm tra lại key và quyền truy cập project."
    return f"{provider_name} lỗi {status}: {compact_text(message)[:420]}"


def extract_score(response: dict[str, Any]) -> dict[str, Any]:
    content = response["choices"][0]["message"]["content"]
    return normalize_score(json.loads(content))


def extract_gemini_score(response: dict[str, Any]) -> dict[str, Any]:
    candidates = response.get("candidates") or []
    if not candidates:
        block_reason = response.get("promptFeedback", {}).get("blockReason", "unknown")
        raise ValueError(f"Gemini không trả kết quả. Block reason: {block_reason}")
    parts = candidates[0].get("content", {}).get("parts", [])
    content = "".join(part.get("text", "") for part in parts)
    return normalize_score(json.loads(content))


def normalize_score(score: dict[str, Any]) -> dict[str, Any]:
    for key in ["ta", "org", "voc", "gra"]:
        value = int(score.get(key, 0))
        score[key] = max(0, min(5, value))
    total = score["ta"] + score["org"] + score["voc"] + score["gra"]
    score["total"] = total
    if total <= 8:
        score["level"] = "A2"
    elif total <= 12:
        score["level"] = "B1-"
    elif total <= 16:
        score["level"] = "B1"
    else:
        score["level"] = "B1+"
    score["flags"] = list(score.get("flags") or [])
    score["note"] = compact_text(score.get("note"))[:160]
    score["suggestion"] = compact_text(score.get("suggestion"))[:260]
    return score


def apply_practice_curve(score: dict[str, Any], answer_word_count: int) -> dict[str, Any]:
    if answer_word_count < PRACTICE_CURVE_MIN_WORDS or SEVERE_FLAGS.intersection(score["flags"]):
        return score

    bonus = 0
    if score["total"] <= 12:
        bonus = 2
    elif score["total"] <= 15:
        bonus = 1

    for _ in range(bonus):
        key = min(["ta", "org", "voc", "gra"], key=lambda item: score[item])
        if score[key] < 5:
            score[key] += 1

    return normalize_score(score)


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON input: {exc}")

    answer = compact_text(payload.get("answer"))
    task = compact_text(payload.get("task"))
    answer_word_count = len(answer.split())
    if not answer:
        print(json.dumps({"ok": False, "error": "Bài viết đang trống."}, ensure_ascii=False))
        return
    if answer_word_count < 20:
        print(json.dumps({"ok": False, "error": "Bài viết quá ngắn để chấm chính xác."}, ensure_ascii=False))
        return

    provider, api_key, model = provider_config()
    if not api_key:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": (
                        "Thiếu GEMINI_API_KEY/GOOGLE_API_KEY hoặc OPENAI_API_KEY. "
                        "Hãy tạo file .env trong exam-app."
                    ),
                },
                ensure_ascii=False,
            )
        )
        return

    if len(task.split()) < 12:
        payload["task"] = f"{task} (Prompt details may be limited; grade general B1 writing quality and format.)"

    prompt = build_prompt(payload)
    try:
        if provider == "gemini":
            try:
                response = call_gemini(api_key, model, gemini_payload(prompt, use_schema=True))
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace")
                if exc.code == 400:
                    response = call_gemini(api_key, model, gemini_payload(prompt, use_schema=False))
                else:
                    print(json.dumps({"ok": False, "error": format_http_error(provider, exc.code, body)}, ensure_ascii=False))
                    return
            score = extract_gemini_score(response)
        else:
            try:
                response = call_openai(api_key, openai_payload(model, prompt, use_schema=True))
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace")
                if exc.code == 400:
                    response = call_openai(api_key, openai_payload(model, prompt, use_schema=False))
                else:
                    print(json.dumps({"ok": False, "error": format_http_error(provider, exc.code, body)}, ensure_ascii=False))
                    return
            score = extract_score(response)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(json.dumps({"ok": False, "error": format_http_error(provider, exc.code, body)}, ensure_ascii=False))
        return
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return

    if len(task.split()) < 12 and "limited_prompt" not in score["flags"]:
        score["flags"].append("limited_prompt")
    score = apply_practice_curve(score, answer_word_count)
    score["ok"] = True
    print(json.dumps(score, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
