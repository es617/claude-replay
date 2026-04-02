# Contributing to claude-replay

Thanks for your interest in contributing! This guide covers the most common contribution: **adding support for a new AI coding agent**.

## Adding a New Format

claude-replay uses a plugin-like architecture for format parsers. Each agent format lives in its own file under `src/formats/`.

### Step 1: Create a format parser

Create `src/formats/my-agent.mjs`:

```js
/**
 * MyAgent format parser.
 *
 * Format: describe the log format here (JSONL, JSON, etc.)
 */

import { cleanSystemTags } from "./shared.mjs";

// Unique format name — used in detectFormat() return value and --format flag
export const name = "my-agent";

/**
 * Detect if a parsed JSONL line belongs to this format.
 * Called with the first parseable JSON object from the file.
 * Return true if this format should handle it.
 *
 * For non-JSONL formats (e.g. single JSON object), export detectFromText(text)
 * instead — see gemini.mjs for an example.
 */
export function detect(firstObj) {
  return firstObj.type === "my_agent_event";
}

/**
 * Parse raw text into Turn[].
 * This is the main entry point — receives the full file content as a string.
 */
export function parse(text) {
  const turns = [];
  // ... parse text into turns ...
  return turns;
}
```

### Step 2: Register the format

Add your format to `src/formats/index.mjs`:

```js
import * as myAgent from "./my-agent.mjs";

// Add to the formats array. Order matters for detection:
// - More specific formats first (check unique fields)
// - Generic formats last (claude-code, cursor)
export const formats = [
  replay,
  codex,
  opencode,
  myAgent,      // <-- add here
  claudeCode,
  cursor,
];

// If your format is NOT line-based JSONL (e.g. single JSON object),
// add it to textDetectors instead and export detectFromText():
export const textDetectors = [
  gemini,
  // myAgent,  // <-- if it needs full-text detection
];
```

### Step 3: Create a test fixture

Create `test/fixture-my-agent.jsonl` (or `.json`) with a minimal but representative session. Include:
- At least 2 turns
- A tool call with result
- A thinking/reasoning block (if the agent supports it)
- A text response block
- Timestamps (if the agent provides them)

### Step 4: Add tests

Add a test section in `test/test-parser.mjs`:

```js
const MY_AGENT_FIXTURE = new URL("./fixture-my-agent.jsonl", import.meta.url).pathname;

describe("MyAgent format", () => {
  it("detects my-agent format", () => {
    assert.equal(detectFormat(MY_AGENT_FIXTURE), "my-agent");
  });

  it("does not confuse my-agent with claude-code", () => {
    assert.equal(detectFormat(FIXTURE), "claude-code");
  });

  it("parses turns from MyAgent session", () => {
    const turns = parseTranscript(MY_AGENT_FIXTURE);
    assert.equal(turns.length, 2);
  });

  // ... format-specific tests for tool mapping, text extraction, etc.
});
```

The existing **Turn structure contract** test suite will automatically validate that every turn has the required fields with correct types, and that indices are sequential. Add your fixture to its list:

```js
const fixtures = [
  // ... existing fixtures ...
  { name: "my-agent", path: MY_AGENT_FIXTURE },
];
```

### Turn structure

Every format parser must produce the same output shape:

```ts
interface Turn {
  index: number;           // Sequential 1-based
  user_text: string;       // The user's prompt (cleaned of system tags)
  blocks: AssistantBlock[];
  timestamp: string;       // ISO 8601 or empty string
  system_events?: string[];
  bookmark?: string;
}

interface AssistantBlock {
  kind: "text" | "thinking" | "tool_use";
  text: string;            // Block content (empty for tool_use)
  tool_call: ToolCall | null;
  timestamp: string | null;
}

interface ToolCall {
  tool_use_id: string;
  name: string;            // Normalized: "Bash", "Read", "Write", "Edit", "Glob", "Grep", etc.
  input: object;           // Normalized input (e.g. { command } for Bash, { file_path } for Read)
  result: string | null;
  resultTimestamp: string | null;
  is_error: boolean;
}
```

### Tool name normalization

Map your agent's tool names to the standard set used by the player:

| Standard name | Description |
|---|---|
| `Bash` | Shell command execution |
| `Read` | File reading |
| `Write` | File creation |
| `Edit` | File modification |
| `Glob` | File search by pattern |
| `Grep` | Content search |
| `WebSearch` | Web search |
| `WebFetch` | URL fetching |

Use a tool map constant (see `gemini.mjs` or `opencode.mjs` for examples). Unknown tool names pass through as-is.

### Input normalization

Normalize tool inputs so the player renders them consistently:

- **Bash**: `{ command: "..." }`
- **Read/Write/Edit**: `{ file_path: "..." }` (plus `content`, `old_string`, `new_string` as appropriate)
- If the agent combines working directory + command, merge them: `cd ${workdir} && ${command}`

### Shared utilities

`src/formats/shared.mjs` provides common helpers:

- `cleanSystemTags(text)` — strip system reminders, IDE context, command metadata
- `extractText(content)` — handle string or block-array content
- `isToolResultOnly(content)` — detect tool-result-only user messages
- `collectAssistantBlocks(entries, start)` — collect Claude-style assistant blocks
- `attachToolResults(blocks, entries, start)` — attach tool results by ID
- `buildTurnsFromEntries(entries)` — full turn-building loop for Claude Code-shaped JSONL
- `filterEmptyTurns(turns)` — drop empty turns and re-index

If your format uses JSONL with `{ type: "user"|"assistant", message: { content } }` entries (like Claude Code), you can use `buildTurnsFromEntries()` directly — see `claude-code.mjs` and `cursor.mjs`. For different structures (single JSON, event-based JSONL), you'll write your own parsing logic but can still use `cleanSystemTags()` and `filterEmptyTurns()` — see `gemini.mjs`, `codex.mjs`, and `opencode.mjs` for examples.

## Running Tests

```bash
npm test              # All tests (unit + e2e)
npm run build         # Build minified template
```

## Other Contributions

- **Bug fixes**: Open a PR with a test that reproduces the bug
- **Player improvements**: Edit `template/player.html` — it's self-contained HTML with inline CSS/JS
- **New features**: Open an issue first to discuss the approach

## Project Structure

```
src/
  parser.mjs           # Public API — delegates to format parsers
  formats/
    index.mjs          # Format registry (detection + dispatch)
    shared.mjs         # Shared utilities
    claude-code.mjs    # Claude Code JSONL
    cursor.mjs         # Cursor JSONL
    codex.mjs          # Codex CLI (legacy + new format)
    gemini.mjs         # Gemini CLI JSON
    opencode.mjs       # OpenCode JSONL
    replay.mjs         # Replay JSONL (our own extract format)
  renderer.mjs         # Node.js HTML renderer (compression, file I/O)
  browser.mjs          # Browser-compatible renderer (website)
  themes.mjs           # Theme system
  secrets.mjs          # Secret redaction
  editor-server.mjs    # Editor HTTP server
  extract.mjs          # JSONL export
template/
  player.html          # Self-contained HTML player template
test/
  test-parser.mjs      # Parser unit tests
  test-cli.mjs         # CLI integration tests
  e2e/                 # Playwright e2e tests
```
