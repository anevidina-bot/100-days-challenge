@echo off
cd /d "%~dp0"
echo Open http://localhost:8787 in your browser.
echo Configure .env for email sign-in. Press Ctrl+C to stop.
node --env-file-if-exists=.env src/server.mjs
pause
