// The rating model now lives in `@test-cabinet/ui` (the single source of truth,
// mirroring the `Rating` enum in the Rust core, crates/core/src/review.rs) so the
// gallery, the web console, and the desktop app all share one definition. This
// module re-exports it and keeps the site-only writeup frontmatter parser, which
// splits a writeup's per-domain ratings + checklist verdicts from its prose body.
//
// A rating is curatorial: it rides in the frontmatter of a run's writeup (see
// writeups.ts), NOT in the run record. A run is rated per scoring domain; its
// overall rating is the worst across them, and its score is the weight of its
// passed checklist items over the total declared weight.
export {
  type Rating,
  RATINGS,
  type RatingMeta,
  RATING_META,
  isRating,
  worstRating,
  type AestheticRating,
  AESTHETIC_RATINGS,
  AESTHETIC_META,
  isAestheticRating,
  worstAestheticRating,
  aggregateAestheticRating,
  type DomainAesthetic,
  type FailureCap,
  FAILURE_CAPS,
  FAILURE_CAP_META,
  FAILURE_CAP_RATING,
  isFailureCap,
  automatedVerdicts,
  automatedOnlyScore,
  validatorDomainRatings,
  validatorRating,
  validatorScore,
  isToolchainGated,
  gatedRating,
  gatedScore,
  type DomainRating,
  type VerdictStatus,
  VERDICT_META,
  isVerdictStatus,
  type GradeStatus,
  type GradeMeta,
  GRADE_LEVELS,
  GRADE_META,
  GRADE_MAX_POINTS,
  OVERALL_VERDICT_ID,
  isGrade,
  gradePoints,
  worstGrade,
  overallGradeOf,
  aggregateOverallGrade,
  type ReviewVerdict,
  type Score,
  type WeightedItem,
  type WeightedSubItem,
  scoreChecklist,
  subItemVerdictId,
  verdictIdsForItem,
  formatPoints,
  type AggregateScore,
  aggregateScore,
  aggregateRating,
} from "@test-cabinet/ui";

import {
  isAestheticRating,
  isGrade,
  isRating,
  isVerdictStatus,
  type DomainAesthetic,
  type DomainRating,
  type GradeStatus,
  type ReviewVerdict,
} from "@test-cabinet/ui";

/**
 * Narrow a summary card's overall-grade field — a `VerdictStatus`, which also
 * covers the binary pass/fail — to one of the five graded tiers, or null. A
 * non-jam run carries none. Shared by every surface that reads a run's grade off
 * its summary card (the home hero, the run tables, the leaderboards) so they all
 * narrow it the same way.
 */
export function asGrade(status: string | null | undefined): GradeStatus | null {
  return status && isGrade(status) ? status : null;
}

/** A writeup split into its per-domain ratings (both channels), its checklist
 * verdicts, and its prose body. */
export interface ParsedWriteup {
  /** The per-domain FUNCTIONAL ratings from the frontmatter, in order. Empty when
   * none was authored — always, on a validator-rated run's review. */
  ratings: DomainRating[];
  /** The per-domain AESTHETIC ratings (`aesthetic.<domain>:` lines), in order.
   * Empty on a legacy run's review, which has no aesthetic channel. */
  aesthetics: DomainAesthetic[];
  /** The reviewer's checklist verdicts, in frontmatter order. Empty when none. */
  checklist: ReviewVerdict[];
  /** The Markdown body with the frontmatter stripped. */
  body: string;
}

// Mirrors the parser in the Rust core: an opening `---` fence, one or more
// `rating.<domain>` / `aesthetic.<domain>` / `review.<id>` keys, and a closing
// `---` line, with the body following.
// Lenient by design — a malformed writeup simply yields no ratings here; the
// publish gate is what actually refuses to release a run without valid ones.
const FRONTMATTER = /^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Split a writeup's frontmatter ratings and checklist verdicts from its body. */
export function parseWriteup(raw: string): ParsedWriteup {
  const withoutBom = raw.replace(/^﻿/, "");
  const match = FRONTMATTER.exec(withoutBom);
  if (!match) {
    return { ratings: [], aesthetics: [], checklist: [], body: raw.trim() };
  }
  const [, frontmatter, body] = match;
  const ratings = readRatings(frontmatter ?? "");
  const aesthetics = readAesthetics(frontmatter ?? "");
  const checklist = readChecklist(frontmatter ?? "");
  return { ratings, aesthetics, checklist, body: (body ?? "").trim() };
}

// Mirrors the Rust parser: each `aesthetic.<domain>: <tier>` line, in order — the
// aesthetic channel's counterpart of `readRatings`. An unknown tier is skipped.
function readAesthetics(frontmatter: string): DomainAesthetic[] {
  const aesthetics: DomainAesthetic[] = [];
  for (const line of frontmatter.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (!key.startsWith("aesthetic.")) continue;
    const domain = key.slice("aesthetic.".length).trim();
    if (!domain) continue;
    const value = line
      .slice(separator + 1)
      .trim()
      .toLowerCase();
    if (!isAestheticRating(value)) continue;
    aesthetics.push({ domain, rating: value });
  }
  return aesthetics;
}

// Mirrors the Rust parser: each `rating.<domain>: <tier>` line, in order. A line
// with an unknown tier is skipped (lenient, like the checklist parse).
function readRatings(frontmatter: string): DomainRating[] {
  const ratings: DomainRating[] = [];
  for (const line of frontmatter.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (!key.startsWith("rating.")) continue;
    const domain = key.slice("rating.".length).trim();
    if (!domain) continue;
    const value = line
      .slice(separator + 1)
      .trim()
      .toLowerCase();
    if (!isRating(value)) continue;
    ratings.push({ domain, rating: value });
  }
  return ratings;
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
    const statusToken = (
      space === -1 ? value : value.slice(0, space)
    ).toLowerCase();
    if (!isVerdictStatus(statusToken)) continue;
    const note = space === -1 ? "" : value.slice(space + 1).trim();
    verdicts.push({ id, status: statusToken, ...(note ? { note } : {}) });
  }
  return verdicts;
}
