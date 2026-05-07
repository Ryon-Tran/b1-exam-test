#!/usr/bin/env python3
"""Local data manager for the Excel-live exam app.

Run this helper when you want the browser app to read exam-data-master.xlsx
through Python. data.js stays as a server-side safety fallback only.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


APP_ROOT = Path(__file__).resolve().parents[1]
HOST = os.environ.get("EXAM_MANAGER_HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT") or os.environ.get("EXAM_MANAGER_PORT", "8788"))


class DataManagerHandler(SimpleHTTPRequestHandler):
    server_version = "ExamDataManager/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/admin/status":
            self.send_json({
                "ok": True,
                "root": str(APP_ROOT),
                "excel": str(APP_ROOT / "exports" / "exam-data-master.xlsx"),
            })
            return
        if path == "/api/exam-data":
            self.run_script("excel-data-source.py")
            return
        if path == "/api/admin/open-excel":
            self.open_file(APP_ROOT / "exports" / "exam-data-master.xlsx")
            return
        if path == "/api/admin/excel-rows":
            self.run_script("excel-admin-api.py", ["list"])
            return
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/admin/import-excel":
            args = ["--sync-raw-lines"] if "syncRaw=1" in parsed.query else []
            self.run_script("import-excel-to-data.py", args)
            return
        if path == "/api/admin/export-excel":
            self.run_script("export-data-to-excel.py")
            return
        if path == "/api/admin/grade-writing":
            self.run_script("grade-writing.py", input_text=self.read_request_body())
            return
        if path == "/api/admin/excel-row":
            self.run_script("excel-admin-api.py", ["update"], input_text=self.read_request_body())
            return
        self.send_json({"ok": False, "error": "Unknown endpoint"}, status=404)

    def read_request_body(self) -> str:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return "{}"
        return self.rfile.read(length).decode("utf-8", errors="replace")

    def run_script(
        self,
        script_name: str,
        extra_args: list[str] | None = None,
        input_text: str | None = None,
    ) -> None:
        command = [sys.executable, str(APP_ROOT / "scripts" / script_name), *(extra_args or [])]
        try:
            completed = subprocess.run(
                command,
                cwd=str(APP_ROOT),
                input=input_text,
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=500)
            return

        payload = {
            "ok": completed.returncode == 0,
            "returnCode": completed.returncode,
            "stdout": completed.stdout.strip(),
            "stderr": completed.stderr.strip(),
            "error": completed.stderr.strip() if completed.returncode else "",
        }
        if script_name in {"grade-writing.py", "excel-data-source.py", "excel-admin-api.py"} and completed.stdout.strip():
            try:
                payload = json.loads(completed.stdout)
            except json.JSONDecodeError:
                pass

        self.send_json(
            payload,
            status=200 if payload.get("ok") else 500,
        )

    def open_file(self, path: Path) -> None:
        if not path.exists():
            self.send_json({"ok": False, "error": f"File not found: {path}"}, status=404)
            return
        try:
            os.startfile(path)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=500)
            return
        self.send_json({"ok": True, "path": str(path)})

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), DataManagerHandler)
    public_host = "127.0.0.1" if HOST == "0.0.0.0" else HOST
    url = f"http://{public_host}:{PORT}/index.html"
    if os.environ.get("EXAM_MANAGER_NO_BROWSER") != "1" and HOST in {"127.0.0.1", "localhost"}:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    print(f"Data Manager is running at {url}")
    print("Close this window to stop it.")
    server.serve_forever()


if __name__ == "__main__":
    main()
