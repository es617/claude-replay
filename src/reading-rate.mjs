/** Standard adult silent-reading rate for English non-fiction. */
export const DEFAULT_READING_WPM = 238;

/** Supported editor and renderer bounds for paced wording. */
export const MIN_READING_WPM = 80;
export const MAX_READING_WPM = 600;

/**
 * Heuristic tuning values for paced wording.
 *
 * These are deliberately centralized because they are perceptual parameters,
 * not authoritative reading-science constants. Adjust them here, then verify
 * the long-form fixture in the editor and run the paced-wording browser tests.
 * Pause values are measured in multiples of the base WPM interval.
 */
export const PACED_WORDING_TUNING = Object.freeze({
  // Section/turn timing, in wall-clock milliseconds before speed scaling.
  segmentGapMinMs: 600,
  segmentGapFallbackMs: 800,
  segmentGapMaxMs: 10_000,
  turnDwellMs: 5_000,

  // Per-word timing. Pause values are multiples of the base WPM interval.
  wordLengthBaseFactor: 0.82,
  wordLengthPerCharFactor: 0.036,
  wordLengthMaxChars: 12,

  // Stable hash jitter: min + (hash % buckets) / divisor.
  wordJitterMin: 0.9,
  wordJitterBuckets: 201,
  wordJitterDivisor: 1_000,

  clausePauseWords: 0.55,
  sentencePauseWords: 1.4,
  structuralPauseWords: 1.8,
});

/** Sentinel kept valid JavaScript until a renderer injects the configured WPM. */
export const READING_WPM_TEMPLATE_PLACEHOLDER = "/*READING_WPM*/0";

/** Sentinel replaced with the serialized tuning object by each renderer. */
export const PACED_WORDING_TUNING_TEMPLATE_PLACEHOLDER = "/*PACED_WORDING_TUNING*/{}";

/** Normalize renderer input without changing its existing number-only contract. */
export function normalizeReadingWpm(value) {
  if (!Number.isFinite(value)) return DEFAULT_READING_WPM;
  return Math.round(Math.max(MIN_READING_WPM, Math.min(value, MAX_READING_WPM)));
}
