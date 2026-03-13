# Agent Smoke Test

Run this checklist when asked to verify claude-replay before a release. Execute each step and report pass/fail.

## Prerequisites

```bash
npm install
npm run build
```

## 1. Unit tests

```bash
npm test
```

All tests must pass with zero failures.

## 2. E2E tests

```bash
npx playwright test
```

All tests must pass. If browsers aren't installed, run `npx playwright install chromium` first.

## 3. CLI — Claude Code format

```bash
node bin/claude-replay.mjs test/fixture.jsonl -o /tmp/smoke-claude.html --no-minify
```

- Verify exit code 0 and "5 turns" in output
- Verify the file exists and is valid HTML: `head -1 /tmp/smoke-claude.html` should show `<!DOCTYPE html>`

## 4. CLI — Cursor format

```bash
node bin/claude-replay.mjs test/fixture-cursor.jsonl -o /tmp/smoke-cursor.html --no-minify
```

- Verify exit code 0 and "2 turns" in output
- Verify the file is valid HTML

## 5. CLI — Codex format

```bash
node bin/claude-replay.mjs test/fixture-codex.jsonl -o /tmp/smoke-codex.html --no-minify
```

- Verify exit code 0 and "3 turns" in output
- Verify the file is valid HTML

## 6. CLI — session ID resolution

```bash
# Should find sessions or show "no session found" (not crash)
node bin/claude-replay.mjs nonexistent-id 2>&1; echo "exit: $?"
```

- Verify it prints a helpful error message mentioning searched paths
- Verify exit code is 1

## 7. CLI — options

```bash
# Turn filtering
node bin/claude-replay.mjs test/fixture.jsonl --turns 1-2 -o /tmp/smoke-turns.html --no-minify 2>&1
# Should say "2 turns"

# Exclude turns
node bin/claude-replay.mjs test/fixture.jsonl --exclude-turns 1,3 -o /tmp/smoke-exclude.html --no-minify 2>&1
# Should say "3 turns"

# Paced timing
node bin/claude-replay.mjs test/fixture.jsonl --timing paced -o /tmp/smoke-paced.html --no-minify 2>&1

# Theme
node bin/claude-replay.mjs test/fixture.jsonl --theme dracula -o /tmp/smoke-theme.html --no-minify 2>&1

# List themes
node bin/claude-replay.mjs --list-themes 2>&1
# Should list theme names

# Bookmarks
node bin/claude-replay.mjs test/fixture.jsonl --mark "1:Start" --mark "3:Middle" -o /tmp/smoke-bookmarks.html --no-minify 2>&1

# Labels
node bin/claude-replay.mjs test/fixture.jsonl --user-label "Dev" --assistant-label "Bot" -o /tmp/smoke-labels.html --no-minify 2>&1

# Redaction
node bin/claude-replay.mjs test/fixture.jsonl --redact "BLE" -o /tmp/smoke-redact.html --no-minify --no-compress 2>&1
# Verify: grep -c "BLE" /tmp/smoke-redact.html should be 0
```

Verify each command exits with code 0.

## 8. CLI — multi-session concat

```bash
node bin/claude-replay.mjs test/fixture.jsonl test/fixture-cursor.jsonl -o /tmp/smoke-concat.html --no-minify 2>&1
```

- Should say "7 turns" (5 + 2)

## 9. CLI — extract

```bash
node bin/claude-replay.mjs extract /tmp/smoke-claude.html -o /tmp/smoke-extracted.json 2>&1
```

- Verify the JSON file contains turn data
- Verify: `node -e "const d=JSON.parse(require('fs').readFileSync('/tmp/smoke-extracted.json','utf8')); console.log(d.turns.length)"` prints 5

## 10. Editor server

```bash
# Start server in background
node bin/claude-replay.mjs --port 17999 &
SERVER_PID=$!
sleep 1

# Test API endpoints
curl -s http://127.0.0.1:17999/api/sessions | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('groups:', d.groups.length)"
curl -s http://127.0.0.1:17999/api/themes | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('themes:', d.length)"

# Load a session
curl -s -X POST http://127.0.0.1:17999/api/load -H 'Content-Type: application/json' -d "{\"path\":\"$(pwd)/test/fixture.jsonl\"}" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('turns:', d.turns.length, 'format:', d.format)"

# Clean up
kill $SERVER_PID
```

- Sessions endpoint should return groups (number depends on machine)
- Themes endpoint should return 6+ themes
- Load should return 5 turns with format "claude-code"

## 11. Compressed vs uncompressed

```bash
node bin/claude-replay.mjs test/fixture.jsonl -o /tmp/smoke-compressed.html --no-minify 2>&1
node bin/claude-replay.mjs test/fixture.jsonl -o /tmp/smoke-uncompressed.html --no-minify --no-compress 2>&1
```

- Both should produce valid HTML
- Compressed file should be smaller: `wc -c /tmp/smoke-compressed.html /tmp/smoke-uncompressed.html`

## Reporting

Report each section as PASS or FAIL. If any section fails, include the error output.
