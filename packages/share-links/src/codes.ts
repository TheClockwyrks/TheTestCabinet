// Short codes: how a run id becomes the part of a link a person can paste.
//
// A code is *derived* from the run id — a prefix of it — rather than assigned from
// a counter or stored in a table. Three things follow, and they are the reason for
// the choice:
//
//  - There is nothing to generate, so there is no write surface to abuse. The set
//    of valid links is exactly the set of published runs, and only the backend can
//    extend that.
//  - It is stable forever. A code is a function of one run's id and nothing else,
//    so a link minted today keeps resolving no matter what is published later.
//  - It is agnostic to the id scheme. Run ids are moving from UUIDv4 to CUID2, and
//    a prefix rule needs no migration and no backfill to span both — a corpus
//    holding some of each resolves with one rule. An assigned-code table would
//    need backfilling across exactly that transition.
//
// A UUID's first eight characters are its first hex group (the `8-4-4-4-12`
// layout puts no dash inside them) and a CUID2 has no dashes at all, so "the first
// N characters, verbatim" is well defined for both.

import type { ShareTarget } from "./entries.js";

/**
 * How many leading characters of a run id form its canonical code.
 *
 * Eight is chosen against the corpus this addresses, not against a general-purpose
 * collision bound: over a few thousand runs the chance that any two ids share an
 * eight-character prefix is on the order of 1 in 10,000 for hex UUIDs, and far
 * smaller for base36 CUID2s. {@link assignShortCodes} handles the case anyway
 * rather than assuming it away.
 */
export const SHORT_CODE_LENGTH = 8;

/** The canonical code for a run: the leading {@link SHORT_CODE_LENGTH} characters
 * of its id, lowercased so a code pasted in either case resolves. */
export function shortCodeFor(runId: string): string {
  return runId.slice(0, SHORT_CODE_LENGTH).toLowerCase();
}

/** The result of assigning codes across a whole corpus. */
export interface CodeAssignment {
  /** Each run id mapped to the code that addresses it. */
  codes: Map<string, string>;
  /**
   * Any group of run ids that shared the canonical code and had to be lengthened
   * to separate them, reported so a build can say so rather than resolving it
   * silently. Empty in the overwhelming case.
   */
  collisions: string[][];
}

/**
 * Assign a code to every run id, lengthening only the members of a colliding
 * group until they separate.
 *
 * Lengthening is confined to the group that collided: every other run keeps the
 * canonical code it would have had anyway, so one unlucky pair cannot invalidate
 * links across the corpus. The lengthened codes are still prefixes of their ids,
 * so {@link resolveCode}'s prefix fallback keeps resolving a link minted at the
 * canonical length for as long as it stays unambiguous.
 */
export function assignShortCodes(runIds: readonly string[]): CodeAssignment {
  const byCanonical = new Map<string, string[]>();
  for (const runId of runIds) {
    const canonical = shortCodeFor(runId);
    const group = byCanonical.get(canonical) ?? [];
    group.push(runId);
    byCanonical.set(canonical, group);
  }

  const codes = new Map<string, string>();
  const collisions: string[][] = [];
  for (const [canonical, group] of byCanonical) {
    if (group.length === 1) {
      codes.set(group[0]!, canonical);
      continue;
    }
    // A duplicate id in the input is not a collision — it is the same run twice,
    // and it maps to the one code.
    const distinct = [...new Set(group)];
    if (distinct.length === 1) {
      codes.set(distinct[0]!, canonical);
      continue;
    }
    collisions.push([...distinct].sort());
    // Grow the prefix until every member of the group is distinguished, stopping
    // at the longest id: two ids that never separate are the same id.
    const longest = Math.max(...distinct.map((id) => id.length));
    let length = SHORT_CODE_LENGTH + 1;
    while (length <= longest) {
      const attempt = distinct.map((id) => id.slice(0, length).toLowerCase());
      if (new Set(attempt).size === distinct.length) break;
      length += 1;
    }
    for (const runId of distinct) {
      codes.set(runId, runId.slice(0, length).toLowerCase());
    }
  }
  return { codes, collisions };
}

/**
 * Resolve a pasted code against the published codes, returning the run id or null.
 *
 * An exact match is the normal path. Failing that the code is treated as an id
 * prefix and accepted when it names exactly one run — which is what keeps an older
 * link working after {@link SHORT_CODE_LENGTH} is raised, or after a collision
 * lengthened some other run's code. An ambiguous prefix resolves to null rather
 * than to an arbitrary one of its candidates.
 */
export function resolveCode(
  code: string,
  codesToRunIds: ReadonlyMap<string, string>,
): string | null {
  const needle = code.toLowerCase();
  const exact = codesToRunIds.get(needle);
  if (exact) return exact;

  let found: string | null = null;
  for (const runId of codesToRunIds.values()) {
    if (!runId.toLowerCase().startsWith(needle)) continue;
    if (found !== null && found !== runId) return null;
    found = runId;
  }
  return found;
}

/** The gallery path a share target names for a run. */
export function runPath(runId: string, target: ShareTarget): string {
  const base = `/runs/${encodeURIComponent(runId)}`;
  return target === "play" ? `${base}/play` : base;
}

/** The short-link path for a code: `/r/<code>` for the verdict page, `/p/<code>`
 * for the play page. Two single letters because the whole point is a short link. */
export function shortLinkPath(code: string, target: ShareTarget): string {
  return `${target === "play" ? "/p" : "/r"}/${encodeURIComponent(code)}`;
}

/** The share target a short-link path names, or null when the path is neither. */
export function targetForPrefix(prefix: string): ShareTarget | null {
  if (prefix === "r") return "verdict";
  if (prefix === "p") return "play";
  return null;
}
