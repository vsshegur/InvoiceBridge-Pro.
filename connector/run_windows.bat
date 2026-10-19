@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel% == 0 (
    py -3 tally_agent.py
) else (
    python tally_agent.py
)
if errorlevel 1 pause
