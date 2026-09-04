// enemies/age-counts-per-tick — an enemy's age rises by TICK_DT on every tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("The life of an
// enemy"): an enemy "spawns ... with `age` `0`", and "`age` is the seconds
// since it spawned: every tick adds `TICK_DT` (`1 / 60`) to it." So a moth
// reads `0` on the tick it is spawned and `TICKS × TICK_DT` after `TICKS`
// ticks, which at `TICKS` (30) is exactly half a second.
//
// WHY THE TICKS ARE RUN WITH enemyMotion OFF. The rise is unconditional:
// `specs/world.md` ("One tick") puts it in phase 4 as "Every enemy ages by
// `TICK_DT`, and, while `enemyMotion` is on, moves", and
// `specs/instrumentation.md` says of the switch that while it is off "Every
// enemy holds its position and heading. `age` and `contactCooldown` still
// count." Holding the moth still is therefore the isolated reading: the age is
// all that changes about it across the span, so a build that counted the age
// inside its movement step fails here by name rather than by some position
// being wrong.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding one moth `POST`
// units out, with every driver switch off: no weapon fires at it, no contact
// reaches it, no director spawn joins it, and it does not move.
//
// THE TOLERANCE. `MOTION_EPS`, the bound for a figure integrated tick after
// tick: the reading is thirty additions of `1 / 60`, and nothing this
// specification distinguishes is finer.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { MOTION_EPS, REAL_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { requireEnemy } from "./roster";

/** Where the moth stands: clear of the lamplighter, so nothing touches it. */
const POST = 300;

/** Ticks of the span: half a second of them. */
const TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads a moth's age as 0 at spawn and as 30 × TICK_DT thirty ticks later", async () => {
  isolate(h);
  const moth = placeEnemyNear(h, "moth", POST, 0);

  assertNear(
    requireEnemy(h.snapshot(), moth).age,
    0,
    REAL_EPS,
    "the moth's age on the tick it was spawned (specs/enemies.md, The life of an enemy)",
  );

  const aged = await advanceTicks(h, TICKS);
  captureStill(h, "age");

  assertNear(
    requireEnemy(aged, moth).age,
    TICKS * TICK_DT,
    MOTION_EPS,
    "the moth's age after 30 ticks (specs/enemies.md, The life of an enemy)",
  );
});
