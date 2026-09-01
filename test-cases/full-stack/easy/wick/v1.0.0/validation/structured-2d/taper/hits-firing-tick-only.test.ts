// Wick — taper/hits-firing-tick-only: the slash has no hitbox on any tick but
// the one it fires on.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Taper"): "A slash is a rectangle of
//     `width × height`: on the tick it fires it hits every enemy overlapping
//     it, and it has no hitbox on any other tick. ... The slash is drawn for
//     `SLASH_FLASH` (`0.1`) seconds." So the zone is still in the world on
//     the tick after the firing, drawn, and hitting nothing.
//   - `specs/instrumentation.md` (`setEnemyPosition`): "Moves enemy `id` to
//     `(x, y)`; its heading, age, and health are untouched."
//   - `specs/weapons.md` ("Cooldown timers"): after firing the timer is set
//     to the cooldown, 1.35 for row 1, so Taper does not fire again on the
//     next tick.
//
// THE DRIVE. An isolated run at the origin facing right, Taper at level 1
// armed, `weaponFire` the one switch on, and a moth posed well clear of the
// rectangle at (player.x + 60, player.y + 200). The firing tick runs: one
// slash appears and the moth is untouched. The moth is then moved to
// (player.x + 60, player.y), the center of the rectangle, and one more tick
// runs with the slash still in the world. The moth keeps its `hp` and is
// still there.
//
// TOLERANCE. `REAL_EPS` on the moth's `hp`, read against the value it was
// posed with; the presence readings are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, TAPER_LEVELS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armTaper, enemyOutcome, hpOf } from "./slash";

/** The row under test: level 1, a 120 × 40 slash. */
const LEVEL = 1;
const ROW = TAPER_LEVELS[LEVEL - 1];

/** Where the moth waits during the firing tick: far below the rectangle. */
const AWAY_DY = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves a moth moved into the slash on the tick after the firing untouched", async () => {
  if (!(AWAY_DY - ROW.height / 2 > 100)) {
    throw new Error("the waiting position must be well clear of the rectangle");
  }

  const posed = isolate(h);
  assertEqual(posed.run.player.facing, "right", "the fresh run's facing");
  const { player } = posed.run;
  const centerX = player.x + ROW.width / 2;
  const moth = placeEnemyNear(h, "moth", ROW.width / 2, AWAY_DY);
  const hpBefore = hpOf(h.snapshot(), moth);
  armTaper(h, LEVEL);

  const fired = await advanceTicks(h, 1);
  assertEqual(
    zonesOfKind(fired, "slash").length,
    ROW.amount,
    "the slashes the firing tick created",
  );
  assertEqual(
    enemyOutcome(fired, moth, hpBefore),
    "untouched",
    "the moth out of reach on the firing tick",
  );

  h.debug.setEnemyPosition(moth, centerX, player.y);
  const after = await advanceTicks(h, 1);
  captureStill(h, "once");

  assertEqual(
    zonesOfKind(after, "slash").length,
    ROW.amount,
    "the slash still in the world on the tick after the firing",
  );
  assertEqual(
    enemyOutcome(after, moth, hpBefore),
    "untouched",
    "the moth inside the slash's rectangle on the tick after the firing",
  );
  assertNear(
    hpOf(after, moth),
    hpBefore,
    REAL_EPS,
    "the moth's hp after the tick inside the rectangle",
  );
});
