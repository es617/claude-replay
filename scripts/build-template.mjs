#!/usr/bin/env node

/**
 * Build minified template from player.html → player.min.html.
 * Minifies CSS and JS (with mangling) using esbuild.
 *
 * Template placeholders like /*TURNS_JSON*​/[] look like JS/CSS comments,
 * so we swap them to safe tokens before minification and restore after.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { transform } from "esbuild";

const TEMPLATE = new URL("../template/player.html", import.meta.url);
const OUTPUT = new URL("../template/player.min.html", import.meta.url);

const src = readFileSync(TEMPLATE, "utf-8");

// Placeholders that use /* */ comment syntax — esbuild strips these.
// Map each to a unique safe token that survives minification.
const PLACEHOLDERS = [
  // CSS placeholder
  { pattern: "/*THEME_CSS*/", token: "__PLACEHOLDER_THEME_CSS__" },
  // JS placeholders (inside string literals or as values)
  { pattern: '"/*TURNS_DATA*/"', token: '"__PLACEHOLDER_TURNS_DATA__"' },
  { pattern: '"/*BOOKMARKS_DATA*/"', token: '"__PLACEHOLDER_BOOKMARKS_DATA__"' },
  { pattern: '"/*FILES_DATA*/"', token: '"__PLACEHOLDER_FILES_DATA__"' },
  { pattern: "/*INITIAL_SPEED*/1", token: "__PLACEHOLDER_INITIAL_SPEED_VAL__" },
  { pattern: "/*INITIAL_SPEED*/", token: "__PLACEHOLDER_INITIAL_SPEED__" },
  { pattern: "/*CHECKED_THINKING*/", token: "__PLACEHOLDER_CHECKED_THINKING__" },
  { pattern: "/*CHECKED_TOOLS*/", token: "__PLACEHOLDER_CHECKED_TOOLS__" },
  { pattern: "/*THEME_BG*/", token: "__PLACEHOLDER_THEME_BG__" },
  { pattern: "/*PAGE_TITLE*/", token: "__PLACEHOLDER_PAGE_TITLE__" },
  { pattern: "/*USER_LABEL*/", token: "__PLACEHOLDER_USER_LABEL__" },
  { pattern: "/*ASSISTANT_LABEL*/", token: "__PLACEHOLDER_ASSISTANT_LABEL__" },
  { pattern: "/*PAGE_DESCRIPTION*/", token: "__PLACEHOLDER_PAGE_DESCRIPTION__" },
  { pattern: "/*OG_IMAGE*/", token: "__PLACEHOLDER_OG_IMAGE__" },
  { pattern: "/*HAS_REAL_TIMESTAMPS*/false", token: "__PLACEHOLDER_HAS_REAL_TIMESTAMPS__false" },
  { pattern: "/*FONT_SIZE*/13px", token: "__PLACEHOLDER_FONT_SIZE__" },
  { pattern: '/*FONT_SIZE_NAME*/"normal"', token: '"__PLACEHOLDER_FONT_SIZE_NAME__"' },
];

// Replace placeholders with safe tokens
let protected_ = src;
for (const { pattern, token } of PLACEHOLDERS) {
  protected_ = protected_.replaceAll(pattern, token);
}

// Verify no /* */ comment placeholders remain
const remaining = protected_.match(/\/\*[A-Z_]+\*\//g);
if (remaining) {
  console.error(`Error: unhandled comment-style placeholders: ${remaining.join(", ")}`);
  process.exit(1);
}

// Extract CSS between <style> and </style>
const styleMatch = protected_.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) {
  console.error("Error: could not find <style> block in template");
  process.exit(1);
}

// Extract JS between <script> and </script>
const scriptMatch = protected_.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  console.error("Error: could not find <script> block in template");
  process.exit(1);
}

const css = styleMatch[1];
const js = scriptMatch[1];

const [minCss, minJs] = await Promise.all([
  transform(css, { loader: "css", minify: true }),
  transform(js, { loader: "js", minify: true, target: "es2020" }),
]);

// Reassemble: split into 5 parts around CSS and JS
const styleOpen = protected_.indexOf("<style>");
const styleClose = protected_.indexOf("</style>");
const scriptOpen = protected_.indexOf("<script>");
const scriptClose = protected_.indexOf("</script>");

const beforeCss = protected_.slice(0, styleOpen + "<style>".length);
const betweenCssAndJs = protected_.slice(styleClose + "</style>".length, scriptOpen + "<script>".length);
const afterJs = protected_.slice(scriptClose + "</script>".length);

let out = beforeCss + "\n" + minCss.code + "</style>" + betweenCssAndJs + "\n" + minJs.code + "</script>" + afterJs;

// Restore original placeholders
for (const { pattern, token } of PLACEHOLDERS) {
  out = out.replaceAll(token, pattern);
}

// Verify all placeholders were restored
for (const { token } of PLACEHOLDERS) {
  if (out.includes(token)) {
    console.error(`Error: token ${token} was not restored — minification may have altered it`);
    process.exit(1);
  }
}

writeFileSync(OUTPUT, out);

const savedPct = Math.round((1 - out.length / src.length) * 100);
console.log(`Built template/player.min.html (${src.length} → ${out.length} bytes, ${savedPct}% smaller)`);
