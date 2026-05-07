@echo off
cd /d "%~dp0"
set EXAM_MANAGER_PORT=8788
python scripts\data-manager-server.py
pause
