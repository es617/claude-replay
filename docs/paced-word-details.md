# Details of `paced-wording`

## Pacing algorithm

The configured WPM is a **base rate**, not the final measured throughput. For each word, the player first computes a base interval:

```text
base_ms = 60,000 / reading_wpm
```

It then computes the word's nominal delay before applying the player speed:

```text
length_factor = 0.82 + 0.036 × min(letter_or_digit_count, 12)
jitter       = deterministic value from 0.90 through 1.10
word_delay   = round(base_ms × length_factor × jitter + punctuation_pause + structural_pause)
wall_time    = word_delay / player_speed  (at a constant speed)
```

Punctuation is excluded from `letter_or_digit_count`. If a token contains no letters or digits, the implementation uses its full text length instead, falling back to 1 for an empty token.

Punctuation and structure add these pauses, expressed as multiples of the base interval:

| Boundary after the word | Added delay |
|---|---:|
| Comma, semicolon, or colon | `0.55 × base_ms` |
| Period, question mark, or exclamation mark | `1.40 × base_ms` |
| Paragraph, list item, heading, table cell, or preformatted-block transition | `1.80 × base_ms` |

Straight single or double quotes, `)`, and `]` may follow punctuation without changing its classification. Sentence and structural pauses can both apply to the same word. The jitter is derived from a stable hash of the word and its position, so it feels less mechanical while remaining reproducible for testing and replay.

The session timer uses the same per-word delays. It also includes the gap between assistant sections: the timestamp delta when both timestamps exist, otherwise 800 ms, with every gap clamped to 600 ms–10 seconds. A 5-second dwell follows each turn, including the final turn. Thinking and tool sections are still revealed as whole sections and therefore do not receive per-word delay.

## Tuning paced wording

All tunable numeric timing heuristics listed below live in the exported `PACED_WORDING_TUNING` object in `src/reading-rate.mjs`. This is the single tuning point used by both the Node renderer and the static website's browser renderer; the generated player receives a serialized copy when it is rendered. The local editor uses the Node renderer.

The parameters are heuristics rather than an authoritative model of human reading. They are grouped by unit and purpose:

| Parameters | Meaning |
|---|---|
| `segmentGapMinMs`, `segmentGapFallbackMs`, `segmentGapMaxMs` | Minimum, missing-timestamp fallback, and maximum assistant-section gaps, in milliseconds |
| `turnDwellMs` | Pause after each turn, in milliseconds |
| `wordLengthBaseFactor`, `wordLengthPerCharFactor`, `wordLengthMaxChars` | Linear word-length adjustment and the character-count cap |
| `wordJitterMin`, `wordJitterBuckets`, `wordJitterDivisor` | Range and resolution of deterministic hash jitter |
| `clausePauseWords`, `sentencePauseWords`, `structuralPauseWords` | Extra delay after punctuation or a structural boundary, in base-word intervals |

The section-gap and turn-dwell fields are shared with regular section-based paced playback, so changing those four values affects both variants. Word-length, jitter, and linguistic-pause fields apply only when **paced wording** is selected. WPM and playback speed remain user-facing controls rather than hyperparameters, while punctuation classification, hashing constants, scrolling, and scheduling are implementation mechanics rather than tuning values.

For visual tuning, launch the editor with the deliberately long fixture:

```bash
node ./bin/claude-replay.mjs editor ./test/e2e/fixture-paced-wording.jsonl
```

Select **paced**, then **paced wording**, and compare several WPM settings. After changing the tuning object, run `npm run build`, `npm test`, and the paced-wording browser tests. Keep the relational invariants covered by `test/test-reading-rate.mjs`; they protect the configuration from nonsensical combinations without pinning every experimental value in a second location.
