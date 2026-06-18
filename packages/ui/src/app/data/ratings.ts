// The rating model now lives in `@test-cabinet/ui` (the single source of truth,
// mirroring the `Rating` enum in the Rust core, crates/core/src/review.rs) so the
// gallery, the web console, and the desktop app all share one definition. This
// module re-exports it and keeps the site-only writeup frontmatter parser, which
// splits a writeup's rating + checklist verdicts from its prose body.
//
// A rating is curatorial: it rides in the frontmatter of a run's writeup (see
// writeups.ts), NOT in the run record. The site shows it per run; it is never
// aggregated or used to rank runs (the gallery is not a leaderboard).
export {
  type Rating,
  RATINGS,
  type RatingMeta,
  RATING_META,
  isRating,
  type VerdictStatus,
  VERDICT_META,
  type ReviewVerdict,
} from "@test-cabinet/ui";

import {
  isRating,
  isVerdictStatus,
  type Rating,
  type ReviewVerdict,
} from "@test-cabinet/ui";

/** A writeup split into its rating, its checklist verdicts, and its prose body. */
export interface ParsedWriteup {
  /** The rating from the frontmatter, or null when none was authored. */
  rating: Rating | null;
  /** The reviewer's checklist verdicts, in frontmatter order. Empty when none. */
  checklist: ReviewVerdict[];
  /** The Markdown body with the frontmatter stripped. */
  body: string;
}

// Mirrors the parser in the Rust core: an opening `---` fence, a `rating` key,
// and a closing `---` line, with the body following. Lenient by design — a
// malformed writeup simply yields no rating here; the publish gate is what
// actually refuses to release a run without a valid one.
const FRONTMATTER = /^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Split a writeup's frontmatter rating and checklist verdicts from its body. */
export function parseWriteup(raw: string): ParsedWriteup {
  const withoutBom = raw.replace(/^﻿/, "");
  const match = FRONTMATTER.exec(withoutBom);
  if (!match) {
    return { rating: null, checklist: [], body: raw.trim() };
  }
  const [, frontmatter, body] = match;
  const rating = readRating(frontmatter ?? "");
  const checklist = readChecklist(frontmatter ?? "");
  return { rating, checklist, body: (body ?? "").trim() };
}

function readRating(frontmatter: string): Rating | null {
  for (const line of frontmatter.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    if (line.slice(0, separator).trim() !== "rating") continue;
    const value = line.slice(separator + 1).trim().toLowerCase();
    return isRating(value) ? value : null;
  }
  return null;
}

// Mirrors the Rust parser: each `review.<id>: <status> [note]` line, in order.
// The value's first token is the status; the remainder is the note. A line with
// an unknown status is skipped (lenient, like the rating parse).
function readChecklist(frontmatter: string): ReviewVerdict[] {
  const verdicts: ReviewVerdict[] = [];
  for (const line of frontmatter.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (!key.startsWith("review.")) continue;
    const id = key.slice("review.".length).trim();
    if (!id) continue;
    const value = line.slice(separator + 1).trim();
    const space = value.search(/\s/);
    const statusToken = (space === -1 ? value : value.slice(0, space)).toLowerCase();
    if (!isVerdictStatus(statusToken)) continue;
    const note = space === -1 ? "" : value.slice(space + 1).trim();
    verdicts.push({ id, status: statusToken, ...(note ? { note } : {}) });
  }
  return verdicts;
}
