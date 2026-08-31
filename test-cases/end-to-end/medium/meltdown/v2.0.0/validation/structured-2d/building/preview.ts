// building/preview — the two readings this group takes again and again.
//
// Both are readings, not thresholds: `heldPreview` names the held preview or
// fails saying the surface reported none, and `probeValid` asks the game's own
// placement check about one footprint. Every figure a check asserts stays in the
// check that asserts it.
//
// Local to this group on purpose. Nothing outside `building/` asks the placement
// check a question, so neither belongs in the shared harness.

import { fail } from "../assert";
import type { BuildSnapshot, Harness, TowerType } from "../harness";

/**
 * The held build preview, or a failure naming the surface member that was
 * missing.
 *
 * specs/building.md: arming holds a preview, so a check that armed a type and
 * found `build` null has found a build that does not hold one.
 */
export function heldPreview(h: Harness): BuildSnapshot {
  const build = h.snapshot().build;
  if (build === null) {
    return fail(
      "a held build preview after arming (specs/building.md, Arming a type)",
      null,
    );
  }
  return build;
}

/**
 * Whether the game's own placement check would accept a `type` footprint
 * anchored at `(col, row)` right now.
 *
 * This is `build.valid` — specs/building.md's six-condition check, asked through
 * the one way the specification offers to ask it — so a caller probing whether a
 * tile is open or blocked is reading the game's rule rather than a mirror of it.
 *
 * It ARMS `type` and MOVES the held preview, so a check that cares what was held
 * before must read that first. It leaves the preview it probed with held.
 */
export function probeValid(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
): boolean {
  h.debug.setArmed(type);
  h.debug.setPreview(col, row);
  return heldPreview(h).valid;
}
