// Arc Foundry — `instrumentation.snapshot-shape`. CASE-PROVIDED. NOT YET WRITTEN.
//
// The manifest declares this point at `instrumentation/snapshot-shape.test.ts`, so the
// declaration resolves and the point is named in every grade. The suite itself is
// still to be written, and until it is this file fails loudly rather than passing
// a build it never checked.
//
// THE REQUIREMENT. On a posed yard carrying a candidate, a component, a
// blocker, a combination tower, a live ground unit and a projectile in flight,
// the snapshot reports version FOUNDRY_DEBUG_VERSION (3) and every field
// specs/instrumentation.md lists with its documented type, each structures
// entry carrying its kind, type, quality, level, col, row, cx, cy, range,
// damage, fireRate, targeting, heading, firing, kills, damageDealt,
// auraRadius, auraBonus and abilities, and each units entry its id, type, x,
// y, hp, maxHp, speed, baseSpeed, flying, frozen, waypointIndex, progress,
// slowFactor, slowUntil, burnDps, burnUntil and invincible.
//
// HOW IT IS DECIDED. Pose a yard exercising every branch of the shape and hold
// each reported field against the documented shape and its derivations. The
// evidence it hands back is `posed` (image): the posed yard the snapshot
// reports.

import { describe, it } from "vitest";

import { fail } from "../assert";

describe("instrumentation.snapshot-shape", () => {
  it("Snapshot reports the full documented shape", () => {
    fail(
      "a validator deciding this point",
      "the suite for `instrumentation.snapshot-shape` has not been written yet",
    );
  });
});
