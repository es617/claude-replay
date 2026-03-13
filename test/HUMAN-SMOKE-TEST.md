# Human Smoke Test

Quick pre-release checklist (~5 minutes). Covers things that require visual/interactive verification and can't be automated.

## Prerequisites

```bash
npm test              # must pass
npm run build         # rebuild minified template
```

## 1. Player — visual check (2 min)

```bash
node bin/claude-replay.mjs test/e2e/fixture.jsonl -o /tmp/human-test.html --open
```

- [ ] Splash screen shows, press Space to dismiss
- [ ] Play button auto-advances through turns, blocks appear one by one
- [ ] Thinking blocks are styled differently (dimmer, italic)
- [ ] Tool calls show name in header, input/result expand on click
- [ ] Edit tool shows diff view (red/green lines)
- [ ] Write tool shows code block
- [ ] Failed tool (turn 4) shows red indicator dot
- [ ] Progress bar moves, timer counts up
- [ ] Arrow keys step forward/back through blocks
- [ ] Speed control works (try 3x)

## 2. Themes (30 sec)

```bash
node bin/claude-replay.mjs test/e2e/fixture.jsonl --theme dracula -o /tmp/human-dracula.html --open
```

- [ ] Dark theme loads, colors look intentional (not broken CSS)
- [ ] Try `--theme github-light` too — light theme should be readable

## 3. Codex replay (30 sec)

```bash
node bin/claude-replay.mjs test/fixture-codex.jsonl -o /tmp/human-codex.html --open
```

- [ ] Turns load, user text shows (not IDE context boilerplate)
- [ ] Bash tool shows command in header
- [ ] Write tool shows file content
- [ ] Edit tool shows diff (turn 3)
- [ ] Thinking blocks show commentary text

## 4. Paced timing (30 sec)

```bash
node bin/claude-replay.mjs test/fixture-cursor.jsonl -o /tmp/human-paced.html --timing paced --open
```

- [ ] Timer shows non-zero duration (not 0:00 or absurd hours)
- [ ] Play auto-advances at reasonable pace
- [ ] Progress bar and timer sync

## 5. Deep link (30 sec)

Open `/tmp/human-test.html#turn=3` in a **new tab** (not by editing URL in existing tab).

- [ ] Jumps to turn 3 with blocks hidden (just header + user text visible)
- [ ] Pressing right arrow reveals first block of turn 3

## 6. Editor (1 min)

```bash
node bin/claude-replay.mjs --port 7332
```

- [ ] Browser opens, sessions panel shows groups (Claude Code and any others you have)
- [ ] Click a session — turns appear in center panel, preview loads in right panel
- [ ] Edit a user message — preview updates after brief delay
- [ ] Toggle a turn checkbox off — preview updates without that turn
- [ ] Change theme in options — preview re-renders
- [ ] Export button downloads an HTML file that opens correctly

## Done

If all checks pass, the release is ready. If anything looks off, note which step failed and the symptom.
