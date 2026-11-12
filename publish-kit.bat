@echo off
rem daily-log-kit: publish a new kit zip to GitHub.
rem Place this file and publish-kit.ps1 in the kit folder (e.g. C:\AllGitRepository\daily-log-kit).
rem Usage: put daily-log-kit-v*.zip in this folder (or Downloads) and double-click, or drop a zip onto this file.
rem The zip with the highest version is used. Zips in this folder are ignored by git (.gitignore).
rem The whole command is on one line so that cmd never re-reads this file after it is overwritten.
(powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-kit.ps1" %* & echo. & pause & exit /b)
