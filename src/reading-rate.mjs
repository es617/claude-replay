/** Standard adult silent-reading rate for English non-fiction. */
export const DEFAULT_READING_WPM = 238;

/** Supported editor and renderer bounds for paced wording. */
export const MIN_READING_WPM = 80;
export const MAX_READING_WPM = 600;

/** Sentinel kept valid JavaScript until a renderer injects the configured WPM. */
export const READING_WPM_TEMPLATE_PLACEHOLDER = "/*READING_WPM*/0";

/** Normalize renderer input without changing its existing number-only contract. */
export function normalizeReadingWpm(value) {
  if (!Number.isFinite(value)) return DEFAULT_READING_WPM;
  return Math.round(Math.max(MIN_READING_WPM, Math.min(value, MAX_READING_WPM)));
}
