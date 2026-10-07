// contact/dawn-precedence — when the dawn tick also leaves hp at or below
// zero, the run ends at dawn.
//
// THE SPEC LINE. `specs/world.md`, "Fallen and dawn": "Dawn is checked first,
// so a tick on which both conditions hold ends the run at dawn." And
// `specs/enemies.md`, "Dawn": "Dawn takes precedence over falling on the same
// tick".
//
// HOW BOTH CONDITIONS LAND ON ONE TICK. `setTick(35999)`, so the next tick is
// `36000`; `hp` posed to `1` through `setHp`, a live value; and a moth
// overlapping the lamplighter with its spawn cooldown due, whose hit of `5`
// lands in phase 7 of that same tick and leaves `hp` at `−4`. Phase 11 then
// finds both rows true, and the screen it chooses is the reading.
//
// WHY THE HIT IS READ FIRST. A build whose moth never hit would show `dawn`
// for the wrong reason, so `hp` at or below `0` is asserted before the screen:
// only then does `dawn` mean precedence rather than an empty night ending.
//
// THE POSE. One moth, `enemyMotion` off, `enemyContact` on, nothing else and
// no director, so the only two things that happen on tick `36000` are the hit
// and the clock.
//
// THE TOLERANCE. A screen name, exact; `hp` as a bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { DAWN_TICK, ENEMIES, LAST_TICK } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** The hp posed: alive, and under the moth's damage. */
const POSED_HP = 1;

/** The moth's center distance: inside its `10 + 12` overlap bound. */
const OFFSET = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("ends the run at dawn rather than fallen when a hit lands on tick 36000", async () => {
  if (!(POSED_HP <= ENEMIES.moth.damage)) {
    throw new Error("the hit must take hp to zero or below");
  }

  isolate(h);
  h.debug.setHp(POSED_HP);
  placeEnemyNear(h, "moth", OFFSET, 0);
  h.debug.setTick(LAST_TICK);
  enable(h, "enemyContact");

  const after = await advanceTicks(h, 1);
  captureStill(h, "precedence");

  assertEqual(after.run.tick, DAWN_TICK, "the ending tick is 36000");
  assertLessThanOrEqual(
    after.run.player.hp,
    0,
    "the moth's hit landed on the dawn tick (specs/world.md, Contact damage)",
  );
  assertEqual(
    after.screen,
    "dawn",
    "the screen when dawn and falling hold on the same tick (specs/world.md, Fallen and dawn)",
  );
});
