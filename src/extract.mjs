/**
 * Extract embedded turn/bookmark data from a generated HTML replay file.
 */

import { inflateSync } from "node:zlib";

/**
 * Decode a data blob — either raw JSON or base64-encoded deflate.
 * For raw JSON (--no-compress mode), undoes the JS string literal escaping
 * applied by escapeJsonForScript before parsing.
 * @param {string} raw
 * @returns {unknown}
 */
function decodeBlob(raw) {
  if (raw.startsWith("[") || raw.startsWith("{") || raw.startsWith("\\")) {
    // Raw JSON (--no-compress mode) — undo JS string literal escaping.
    // Process char-by-char to correctly handle \\ vs \" vs \n etc.
    let json = "";
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === "\\" && i + 1 < raw.length) {
        const next = raw[i + 1];
        if (next === "\\") { json += "\\"; i++; }
        else if (next === '"') { json += '"'; i++; }
        else if (next === "n") { json += "\n"; i++; }
        else if (next === "r") { json += "\r"; i++; }
        else { json += raw[i]; } // pass through unknown escapes
      } else {
        json += raw[i];
      }
    }
    // Undo HTML-in-script escapes (these don't use backslash)
    json = json.replace(/<\\\//g, "</").replace(/<\\!--/g, "<!--");
    return JSON.parse(json);
  }
  // Compressed: base64-encoded deflate
  return JSON.parse(inflateSync(Buffer.from(raw, "base64")).toString());
}

/**
 * Find all data blobs passed to the async decode function.
 * Works with both minified (e.g. `f=await Tt("...")`) and
 * unminified (`const TURNS = await decodeData("...")`) output.
 * Handles escaped quotes within the data blob.
 * Returns blobs in source order: [turnsBlob, bookmarksBlob].
 * @param {string} html
 * @returns {string[]}
 */
function findBlobs(html) {
  const blobs = [];
  const pattern = /await\s+[\w$]+\("/g;
  let m;
  while ((m = pattern.exec(html)) !== null) {
    const start = m.index + m[0].length;
    // Find the closing unescaped "); — skip escaped quotes \"
    let i = start;
    while (i < html.length) {
      if (html[i] === "\\") {
        i += 2; // skip escaped character
        continue;
      }
      if (html[i] === '"' && html[i + 1] === ")") {
        blobs.push(html.slice(start, i));
        break;
      }
      i++;
    }
  }
  return blobs;
}

/**
 * Extract turns and bookmarks from a generated HTML replay string.
 * @param {string} html
 * @returns {{ turns: object[], bookmarks: object[] }}
 */
export function extractData(html) {
  const blobs = findBlobs(html);

  // The template has exactly two decode calls: TURNS first, BOOKMARKS second.
  if (blobs.length < 2) {
    throw new Error("Could not find data blobs in HTML (expected at least 2 decodeData calls)");
  }

  return {
    turns: decodeBlob(blobs[0]),
    bookmarks: decodeBlob(blobs[1]),
  };
}
