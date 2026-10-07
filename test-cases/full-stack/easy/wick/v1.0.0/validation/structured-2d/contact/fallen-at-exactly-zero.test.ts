// contact/fallen-at-exactly-zero — hp landing on exactly zero ends the run.
//
// THE SPEC LINE. `specs/world.md`, "Fallen and dawn", the Fallen row:
// condition "`hp` is `0` or below". The "or below" half is `fallen-at-zero`'s
// point; this one is the "`0`" half, the edge a build that tests `< 0` gets
// wrong.
//
// HOW HP LANDS ON ZERO. `hp` posed to `5` through `setHp` and a moth whose
// damage is exactly `5` (`specs/enemies.md`) overlapping the lamplighter with
// its spawn cooldown due. No Brass, so the hit removes `max(1, 5 − 0) = 5` and
// leaves `5 − 5 = 0`: two small integers, so the result is `0` to the bit and
// nothing about floating point puts it a hair to either side.
//
// THE POSE. One moth, `enemyMotion` off, `enemyContact` on, nothing else. The
// hit is read first, so a build whose moth did not hit fails on that rather
// than on an ending it was never asked for.
//
// THE TOLERANCE. `hp` is compared exactly, since `5 − 5` has no rounding, and
// the screen name is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENEMIES } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** The hp posed: exactly the moth's damage. */
const POSED_HP = ENEMIES.moth.damage;

/** The moth's center distance: inside its `10 + 12` overlap bound. */
const OFFSET = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("ends the run fallen on the tick a moth's hit of 5 leaves hp at exactly 0", async () => {
  isolate(h);
  h.debug.setHp(POSED_HP);
  placeEnemyNear(h, "moth", OFFSET, 0);
  enable(h, "enemyContact");

  const after = await advanceTicks(h, 1);
  captureStill(h, "exact");

  assertEqual(
    after.run.player.hp,
    0,
    `hp after a moth's hit of ${ENEMIES.moth.damage} on hp ${POSED_HP} (specs/world.md, Contact damage)`,
  );
  assertEqual(
    after.screen,
    "fallen",
    "the screen when hp is exactly 0 at the end of the tick (specs/world.md, Fallen and dawn)",
  );
});
