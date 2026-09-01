// contact/fallen-at-exactly-zero — health at exactly 0 ends the run.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Fallen and dawn"): "Fallen |
// `hp` is `0` or below. | `fallen`". The condition includes 0 itself, and
// specs/instrumentation.md's `setHp` says the same of a posed value: "A value
// at or below `0` ends the run fallen". A moth's damage is 5 (specs/enemies.md —
// "Moth | `moth` | 5 | 100 | 5 | 10"), so from an `hp` of 5 its hit leaves
// exactly 0.
//
// 0 IS THE BOUNDARY, and it is reached by a real hit rather than posed: a build
// that wrote `hp < 0` for the ending plays on here with `hp` at 0, while a build
// that wrote the stated `0 or below` ends. The `hp` the tick left is read too,
// so a build whose moth hit for the wrong figure is told apart from one whose
// ending is wrong.
//
// THE DRIVE. An isolated night with `enemyContact` on and `enemyMotion` off,
// `hp` posed to 5, and one moth 5 units from the lamplighter's center, well
// inside its radius 10 plus `PLAYER_RADIUS` 12, with the cooldown 0 it spawned
// with. Recovery is 0 with no Tinder held, so nothing lifts `hp` off 0 before
// the ending is checked. One tick is run.
//
// THE TOLERANCE. `FLOAT_TOL` on the health, which is `5 - 5` exactly; none on
// the screen name.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  player,
  type Harness,
} from "../harness";

/** The health posed before the hit: exactly a moth's damage. */
const POSED_HP = ENEMIES.moth.damage;

/** How far from the center the moth is posed: well inside 10 + 12. */
const MOTH_OFFSET = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run fallen on the tick a hit leaves hp at exactly 0", async () => {
  await isolate(h, { on: ["enemyContact"] });
  await h.debug.setHp(POSED_HP);
  await placeEnemyNear(h, "moth", MOTH_OFFSET, 0);

  const after = await h.step(1);

  // The screen the tick left. Captured before the assertions, so a failing
  // build leaves the picture that shows why.
  await captureStill(h, "exact");

  assertNear(
    player(after).hp,
    0,
    FLOAT_TOL,
    "hp after a moth's 5 lands on an hp of 5",
  );
  assertEqual(after.screen, "fallen", "the screen the tick left at hp 0");
});
