// Implementation ratings: the reviewer's subjective quality tier for a finished
// run, assigned by hand while playing the build. A rating rides in the
// frontmatter of a run's writeup (see writeups.ts), NOT in the run record — it
// is curatorial, like the writeup itself. The site shows it per run; it is never
// aggregated or used to rank runs (the gallery is not a leaderboard, see
// docs/site.md).
//
// This mirrors the `Rating` enum in the Rust core (crates/core/src/review.rs);
// keep the tiers in lockstep.

/** A quality tier, ordered best to worst. */
export type Rating = "flawless" | "great" | "scuffed" | "broken";

/** Every rating, ordered best to worst. */
export const RATINGS: readonly Rating[] = [
  "flawless",
  "great",
  "scuffed",
  "broken",
];

/** Display metadata for a rating tier. */
export interface RatingMeta {
  /** Title-case label, e.g. "Great". */
  label: string;
  /** What the tier means, shown alongside the label on a run's page. */
  description: string;
}

export const RATING_META: Record<Rating, RatingMeta> = {
  flawless: {
    label: "Flawless",
    description: "Implemented according to spec with no noticeable bugs.",
  },
  great: {
    label: "Great",
    description:
      "Implemented according to spec. May have minor issues so long as they don't impact playability.",
  },
  scuffed: {
    label: "Scuffed",
    description:
      "Mostly implemented according to spec. Playable, but may deviate from the spec or have bugs that impact playability.",
  },
  broken: {
    label: "Broken",
    description:
      "Doesn't follow the spec or has bugs severe enough to render the game unplayable.",
  },
};

/** Narrowing type guard for {@link Rating}. */
export function isRating(value: string): value is Rating {
  return (RATINGS as readonly string[]).includes(value);
}

/** A reviewer's verdict on one declared checklist item. */
export type VerdictStatus = "pass" | "fail" | "na";

/** Display metadata for a verdict status. */
export const VERDICT_META: Record<VerdictStatus, { label: string }> = {
  pass: { label: "Pass" },
  fail: { label: "Fail" },
  na: { label: "N/A" },
};

/** A reviewer's recorded verdict on one declared checklist item. */
export interface ReviewVerdict {
  /** The declared item's stable id. */
  id: string;
  /** The reviewer's verdict. */
  status: VerdictStatus;
  /** An optional one-line note, when the reviewer left one. */
  note?: string;
}

function isVerdictStatus(value: string): value is VerdictStatus {
  return value === "pass" || value === "fail" || value === "na";
}

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
