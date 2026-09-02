// contact/contact-cooldown-set — a hit sets the enemy's contact cooldown.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Contact damage"): "An
// overlapping enemy whose `contactCooldown` is due lands a hit: `hp` falls by
// `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`, and its `contactCooldown` is
// set to `CONTACT_COOLDOWN`", with "Seconds between hits by one enemy |
// `CONTACT_COOLDOWN` | `0.5`". The snapshot reports each enemy's
// `contactCooldown` as "Seconds until it can hit the lamplighter again"
// (specs/instrumentation.md — "Snapshot shape"), so the tick's own snapshot
// reads 0.5 on the enemy that hit.
//
// WHY 0.5 AND NOT LESS. Phase 7 of specs/world.md ("One tick") counts the
// cooldown down BEFORE the hit is decided: "Every live enemy's `contactCooldown`
// counts down, and, while `enemyContact` is on, an overlapping enemy whose
// cooldown is due hits". The set to `CONTACT_COOLDOWN` is the last thing the
// phase does to that enemy, so the reading on the hit's tick is the full 0.5,
// and the first count-down against it lands on the next tick.
//
// THE DRIVE. An isolated night with `enemyContact` on and `enemyMotion` off, one
// moth 5 units from the lamplighter's center (its radius 10 plus `PLAYER_RADIUS`
// 12 is 22, so it overlaps), its cooldown the 0 it spawned with, which is due at
// once. One tick is run, and the moth's cooldown is read off that tick's
// snapshot.
//
// THE TOLERANCE. `TIMER_TOL`: a timer set to a stated figure reads that figure
// exactly, and the allowance is for a build that stores it in ticks and converts
// back. A build that never sets it reads 0, and one that counts it down on the
// same tick reads 0.4833, both far outside.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { CONTACT_COOLDOWN, TIMER_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** How far from the center the moth is posed: well inside 10 + 12. */
const MOTH_OFFSET = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads contactCooldown 0.5 on the enemy that hit, on the hit's tick", async () => {
  await isolate(h, { on: ["enemyContact"] });
  const moth = await placeEnemyNear(h, "moth", MOTH_OFFSET, 0);

  const after = await h.step(1);

  // The moth on the lamplighter with its hit landed. Captured before the
  // assertion, so a failing build leaves the picture that shows why.
  await captureStill(h, "cooldown");

  assertNear(
    mustEnemy(after, moth.id).contactCooldown,
    CONTACT_COOLDOWN,
    TIMER_TOL,
    "the moth's contactCooldown on the tick it hit",
  );
});
