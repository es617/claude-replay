# VS GitHub Chat Version — Implementation Plan

## Purpose

Create a `claude-replay` variant that supports a **VS GitHub Chat** workflow with:
- local session storage and discovery
- parser support for GitHub chat transcripts
- VS Code-adaptive theming
- zero regression for existing Claude/Cursor/Codex support

This document is an execution plan (how-to + reference) for implementation in this repository.

---

## Scope

### In scope

1. Add a new transcript format: `github-chat`
2. Parse `github-chat` logs into the existing `Turn[]` model
3. Discover local `github-chat` session files in the editor
4. Resolve session IDs from CLI for the new source
5. Add a VS Code-like adaptive theme option
6. Add tests and fixtures for all of the above

### Out of scope (for first iteration)

- Direct GitHub API fetching of chats
- User authentication in the app
- Cloud sync/multi-device session sharing
- Editing assistant/tool blocks (remain read-only)

---

## Architecture Fit

Current extension points to use:

- CLI entry and option handling: `bin/claude-replay.mjs`
- Format detection and parsing: `src/parser.mjs`
- Local session discovery in web editor: `src/editor-server.mjs`
- Session ID resolution in CLI mode: `src/resolve-session.mjs`
- Theme catalogue and CSS mapping: `src/themes.mjs`
- Rendering/export unchanged contract: `src/renderer.mjs`

Design principle: **introduce `github-chat` as a first-class format without changing downstream renderer contracts**.

---

## Data Contract (v1)

### Proposed local storage root

- macOS/Linux: `~/.vs-github-chat/sessions/`
- Windows: `%USERPROFILE%/.vs-github-chat/sessions/` (resolved via `homedir()`)

Each session is a JSONL file.

### JSONL event schema (v1)

Each line is a JSON object with a top-level `type`.

Mandatory common fields:
- `type: string`
- `timestamp: string` (ISO 8601 preferred; optional but recommended)

Supported event types:

1. `user`
   - `content: string | { text: string }[]`
2. `assistant`
   - `content: ({ type: "text", text: string } | { type: "thinking", thinking: string })[]`
3. `tool_use`
   - `id: string`
   - `name: string`
   - `input: object`
4. `tool_result`
   - `tool_use_id: string`
   - `content: string | { type: "text", text: string }[]`
   - `is_error?: boolean`
5. `meta` (optional; ignored for replay turn building)

### Example session snippet

```json
{"type":"user","timestamp":"2026-03-13T10:01:00.000Z","content":"Create a dark mode toggle"}
{"type":"assistant","timestamp":"2026-03-13T10:01:05.000Z","content":[{"type":"thinking","thinking":"Need to inspect current theme variables."},{"type":"text","text":"I’ll inspect the theme system first."}]}
{"type":"tool_use","timestamp":"2026-03-13T10:01:07.000Z","id":"t1","name":"Bash","input":{"command":"ls src"}}
{"type":"tool_result","timestamp":"2026-03-13T10:01:08.000Z","tool_use_id":"t1","content":"themes.mjs\nrenderer.mjs"}
{"type":"assistant","timestamp":"2026-03-13T10:01:10.000Z","content":[{"type":"text","text":"Found `themes.mjs`; next I’ll add a new theme."}]}
```

### Mapping to internal `Turn[]`

- Start a new turn on each `user` event
- Attach subsequent `assistant`/`tool_*` blocks until next `user`
- `tool_use` becomes a `tool_call` block
- `tool_result` attaches by `tool_use_id`
- If timestamps missing, allow downstream paced timing behaviour

---

## Work Plan

## Phase 1 — Parser support

### Tasks

1. Update `detectFormat()` in `src/parser.mjs`
   - recognise `github-chat` via top-level `type` values set (`user`, `assistant`, `tool_use`, `tool_result`) with schema signature distinct from existing formats

2. Add `parseGitHubChatTranscript(filePath)`
   - robust JSONL reading
   - tolerant of malformed lines (skip invalid JSON lines)
   - turn-building logic per mapping above
   - drop empty turns and re-index

3. Integrate in `parseTranscript()` dispatch
   - `if (format === "github-chat") return parseGitHubChatTranscript(filePath)`

### Acceptance criteria

- Valid `github-chat` fixture parses to stable `Turn[]`
- Tool calls/results are paired correctly
- Existing format tests still pass

---

## Phase 2 — Local session discovery

### Tasks

1. Extend `discoverSessions()` in `src/editor-server.mjs`
   - add group label: `VS GitHub Chat`
   - scan `~/.vs-github-chat/sessions/` recursively or by date folder strategy
   - list `.jsonl` files with `mtime` sorting (newest first)

2. Extend `resolveSessionId()` in `src/resolve-session.mjs`
   - support matching in new root
   - return `group: "VS GitHub Chat"`

### Acceptance criteria

- Sessions appear in editor sidebar under new group
- CLI session ID resolution works for this source

---

## Phase 3 — VS Code-adaptive theme

### Tasks

1. Add new built-in theme in `src/themes.mjs`
   - name: `vscode`
   - initial palette aligned with VS Code Dark+ defaults

2. Optional enhancement in `template/editor.html`
   - infer light/dark mode from browser media query
   - set default UI mode accordingly

3. Keep explicit user override behaviour
   - `--theme` and editor theme dropdown must always win over automatic defaults

### Acceptance criteria

- `--list-themes` includes `vscode`
- Exported replay visually consistent with VS Code style intent
- No regression to existing themes

---

## Phase 4 — Tests and fixtures

### Tasks

1. Add fixtures in `test/fixtures/`
   - `github-chat-basic.jsonl`
   - `github-chat-tool-calls.jsonl`
   - `github-chat-no-timestamps.jsonl`

2. Add parser tests in existing test suite
   - format detection
   - turn extraction
   - tool pairing
   - fallback timing path compatibility

3. Add session resolution tests if present pattern exists

### Acceptance criteria

- `npm test` passes
- New parser paths are covered
- Hidden-test-friendly behaviour (malformed line tolerance, empty turn filtering)

---

## Delivery Sequence

1. Phase 1 (parser)
2. Phase 4 parser tests (immediately after Phase 1)
3. Phase 2 (session discovery + resolve)
4. Phase 3 (theme)
5. full test run + manual editor smoke test

Reason: parser + tests first gives fast confidence before UI/discovery work.

---

## Risks and Mitigations

1. **Ambiguous format detection**
   - Mitigation: strict signature checks for `github-chat`; do not overlap with existing codex/claude/cursor checks.

2. **Unpaired tool results**
   - Mitigation: pending map keyed by `tool_use_id`; ignore orphan results safely.

3. **Windows path edge cases**
   - Mitigation: always use `homedir()` + `path.join()`; avoid hard-coded separators.

4. **Theme drift vs user expectation**
   - Mitigation: ship `vscode` theme as explicit option and keep user-selected themes authoritative.

---

## Done Definition

Feature is complete when all are true:

- `github-chat` transcript format is parsed and rendered
- local sessions are discoverable and loadable in editor UI
- CLI can resolve and replay `github-chat` sessions
- VS Code-like theme is available and usable
- tests pass with no regressions
- documentation updated (README sections: Supported formats, Session locations, Themes)

---

## Next Immediate Actions

1. Implement Phase 1 parser and detection
2. Add parser fixtures/tests in same commit
3. Run tests and fix edge cases before moving to discovery/theming
