# Changelog

## 0.8.0

### Player
- File activity sidebar — shows which files were touched during the session, click to jump to the relevant tool call
- LCS-based diff rendering for Edit/Write tool calls (falls back to simple diff for large inputs)
- Font size control (small/normal/large) in filter popover and more menu

### Editor
- Shift+click hint in turn list toolbar
- Font size option in playback settings

### Architecture
- Parser refactored into modular format plugins under `src/formats/` — each format is a self-contained module with `detect()` and `parse()` exports
- New contributor guide (`CONTRIBUTING.md`) with step-by-step instructions for adding new agent format support
- Turn structure contract tests validate all formats produce the same output shape

## 0.7.0

### New Formats
- Gemini CLI transcript support — auto-detected JSON format with inline thinking and tool calls
- OpenCode CLI transcript support — auto-detected JSONL format with reasoning and tool calls across multiple providers

## 0.6.2

### Editor
- Shift+click range selection for turn checkboxes

### Docs
- Add `--init` to Docker commands for proper Ctrl+C handling

## 0.6.1

### Player
- Turn skip buttons (⏮/⏭) for jumping between turns
- Auto-paced timing toggle — viewers can switch between real and smooth paced timing in the speed menu
- Responsive controls: title hidden below 480px, speed/filter/chapters collapse into more menu below 600px
- "Open in new tab" link in more menu for iframe embeds

### Editor
- Sessions sorted by modification time instead of UUID alphabetical order

## 0.6.0

### New
- `--serve` — serve the replay on a local HTTP server instead of writing to file
- `--watch` — watch input files for changes and auto-regenerate the replay
- `--serve --watch` — live-updating replay in the browser, auto-follows new turns
- `--no-origin-check` — disable CSRF origin check for remote/containerized environments
- `CLAUDE_REPLAY_ALLOWED_ORIGINS` env var — whitelist specific origins for the editor server
- `#turn=Nr` hash syntax — deep link to a turn with blocks revealed (used by watch mode)
- Static website at es617.github.io/claude-replay with online replay generator

## 0.5.3

### Fixes
- Fix editor failing on Windows (path separator in home directory check)

## 0.5.2

### New
- `claude-replay editor <file|session-id>` — open the editor with a session pre-loaded

## 0.5.1

### New
- Docker support — image published to GHCR on each release
- `--host` flag for editor server (use `0.0.0.0` for Docker/container access)
- `extract` now outputs JSONL by default (one turn per line, bookmarks embedded)
- Extracted JSONL can be fed back into `claude-replay` to regenerate with different options
- `--format json` flag to preserve legacy JSON output from extract

## 0.5.0

### Editor
- Import HTML — re-edit previously exported replays via button or file browser
- Export JSON — download session data (turns and bookmarks) as JSON
- Content search — type `/` in session filter to search across all session files
- Collapsible sub-blocks — tool calls and thinking collapsed by default, text open, click headers to toggle
- Expand All / Collapse All buttons in toolbar
- Ctrl/Cmd+F expands all blocks for browser search
- Excluded turns and bookmarks persist when switching sessions
- Autosave edits to `~/.claude-replay/autosave/`, restored on reopen
- Reset confirmation modal (only when changes exist)
- Reset indicator includes excluded turns and bookmarks, not just text edits
- Options organized into Playback, Appearance, Content, Metadata, and Output groups
- Browse panel shows `.html` files alongside `.jsonl`
- Friendly error for non-replay HTML files

### Player
- Fix play from last turn resetting to beginning

## 0.4.1

### Fixes
- Fix `extract` command failing on minified replays

## 0.4.0

### Web Editor
- New web-based editor UI (`claude-replay` with no args or `claude-replay editor`)
- Three-panel layout: session browser, turn editor, live preview
- Browse and search Claude Code, Cursor, and Codex CLI sessions
- Edit user prompts with live preview updates
- Include/exclude individual turns, bulk select, add bookmarks
- Configure theme, speed, timing, redaction, labels, and metadata
- Export to self-contained HTML from the editor
- File browser with home directory restriction
- Version shown in help modal

### Codex CLI Support
- Parse Codex CLI transcripts (`~/.codex/sessions/`)
- Normalize `exec_command` → Bash with command preview in header
- Normalize `apply_patch` → Edit (diff view) or Write (code block)
- Extract user text from IDE context boilerplate
- Map commentary phase to thinking blocks, final_answer to text blocks
- Session discovery in editor and CLI session ID resolver

### New Features
- Session chaining: concatenate multiple sessions into one replay (up to 20)
- Session ID lookup: pass a session ID instead of a file path, searches `~/.claude/projects/`, `~/.cursor/projects/`, and `~/.codex/sessions/`
- `--version` / `-v` flag
- `--port N` flag for editor server

### Player
- Unified navigation: all entry points (splash, deep link, play) show turn header first with blocks hidden

### Fixes
- Fix `--list-themes` being blocked by editor server launch
- Fix paced timing calculation bugs
- Fix sidebar visibility after browser resize
- Fix Cursor session discovery for `<uuid>.jsonl` filenames


## 0.3.0

### New commands
- `extract` subcommand: recover embedded turn/bookmark data from a generated replay HTML

### New flags
- `--exclude-turns N,N,...`: exclude specific turns by index (combines with `--turns`)
- `--redact "text"` / `--redact "text=repl"`: custom string replacement at generation time
- `--no-auto-redact`: disable built-in secret pattern redaction (renamed from `--no-redact`)
- `--description TEXT`: customize meta description for link previews
- `--og-image URL`: customize OG image for link previews
- `--open`: launch replay in default browser after generation

### Player
- Keyboard shortcuts: `Shift+→/L` and `Shift+←/H` to jump between turns
- Keyboard shortcuts: `T` / `Shift+T` to jump between thinking/tool blocks
- Active block indicator (left border highlight)
- OG/Twitter meta tags with default image for link previews

### Other
- Default OG image hosted on GitHub Pages
- Fix `npm test` to avoid Playwright/Node test runner conflict

## 0.2.0

### Player
- Diff view for Edit tool calls: removed lines in red, added lines in green (unified diff style)
- Code block view for Write tool calls instead of raw JSON
- Smarter tool header previews: file path for Edit/Write/Read, pattern for Grep/Glob, command for Bash
- Red indicator dot on failed tool calls (individual and grouped)
- Red result text for error messages
- `<tool_use_error>` XML tags stripped from error results for clean display

### Parser
- Cursor agent transcript support (auto-detected, paced timing)
- Pass `is_error` flag from tool results through to renderer
- Strip `<tool_use_error>` wrapper tags from tool result text
- Strip `<ide_opened_file>` tags from VS Code extension transcripts

### Other
- Raise tool grouping threshold from 3 to 5 consecutive calls for better per-tool visibility
- Add Privacy section to README
- Add e2e tests for diff view, Write view, error indicators, and tag stripping (32 total)

## 0.1.2

- Fix: expanding a block while paused then stepping forward now reveals the next block instead of jumping to the next turn
- Fix: expanded blocks are now collapsed when rewinding
- Fix: `#turn=0` deep link shows splash screen instead of blank page
- Add Playwright e2e integration tests (25 tests covering playback, stepping, expand/collapse, keyboard shortcuts, navbar, progress bar, speed control, chapters)

## 0.1.1

- Fix README screenshot layout for npm

## 0.1.0 — Initial release

### Player
- Interactive playback with block-by-block animation
- Step forward/back through individual blocks within turns
- Session timer (elapsed / total) with per-second ticking during playback
- Speed control (0.5x to 5x), timer scales with playback speed
- Progress bar with turn dots, bookmark dots, and hover tooltip
- Bookmarks / chapters with dropdown navigation
- Toggle visibility of thinking blocks and tool calls
- Keyboard shortcuts: Space/K (play/pause), arrows/H/L (step)
- Splash screen with play button, skip via click or keyboard
- Bottom-anchored scrolling with smooth animations
- Embeddable via iframe with adaptive layout

### Themes
- Built-in themes: `tokyo-night` (default), `monokai`, `solarized-dark`, `github-light`, `dracula`, `bubbles`
- Custom themes via `--theme-file` with JSON color overrides
- `extraCss` support for full layout customization

### Parser
- Handles Claude Code streaming format (incremental content blocks)
- Merges consecutive command messages (slash commands + stdout)
- Strips internal tags (`<system-reminder>`, `<local-command-caveat>`, etc.)
- Filters empty turns and "No response requested." boilerplate
- Time range and turn range filtering

### Output
- Single self-contained HTML file, zero external dependencies
- Deflate + base64 compression (~60-70% size reduction)
- Minified CSS/JS via esbuild
- Automatic secret redaction (API keys, tokens, connection strings, etc.)
