import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_READING_WPM,
  MIN_READING_WPM,
  MAX_READING_WPM,
  PACED_WORDING_TUNING,
  normalizeReadingWpm,
} from "../src/reading-rate.mjs";

describe("reading rate policy", () => {
  it("keeps the research-backed default as a public contract", () => {
    assert.equal(DEFAULT_READING_WPM, 238);
  });

  it("normalizes representative finite values", () => {
    const samples = [MIN_READING_WPM - 50, MIN_READING_WPM, 173.4, 417.8, MAX_READING_WPM, MAX_READING_WPM + 500];
    for (const value of samples) {
      const normalized = normalizeReadingWpm(value);
      assert.ok(Number.isInteger(normalized));
      assert.ok(normalized >= MIN_READING_WPM);
      assert.ok(normalized <= MAX_READING_WPM);
      if (value >= MIN_READING_WPM && value <= MAX_READING_WPM) {
        assert.equal(normalized, Math.round(value));
      }
    }
  });

  it("uses the default for non-finite and non-numeric input", () => {
    for (const value of [undefined, null, "fast", NaN, Infinity, -Infinity]) {
      assert.equal(normalizeReadingWpm(value), DEFAULT_READING_WPM);
    }
  });

  it("exposes a valid, immutable paced-wording tuning surface", () => {
    const tuning = PACED_WORDING_TUNING;
    assert.ok(Object.isFrozen(tuning));
    assert.ok(Object.values(tuning).every((value) => Number.isFinite(value) && value > 0));

    assert.ok(tuning.segmentGapMinMs <= tuning.segmentGapFallbackMs);
    assert.ok(tuning.segmentGapFallbackMs <= tuning.segmentGapMaxMs);
    assert.ok(tuning.wordLengthPerCharFactor < tuning.wordLengthBaseFactor);
    assert.ok(tuning.clausePauseWords < tuning.sentencePauseWords);
    assert.ok(tuning.sentencePauseWords <= tuning.structuralPauseWords);

    assert.ok(Number.isInteger(tuning.wordLengthMaxChars));
    assert.ok(Number.isInteger(tuning.wordJitterBuckets));
    assert.ok(Number.isInteger(tuning.wordJitterDivisor));
    const jitterMax = tuning.wordJitterMin + (tuning.wordJitterBuckets - 1) / tuning.wordJitterDivisor;
    assert.ok(tuning.wordJitterMin < 1 && jitterMax > 1);
  });
});
