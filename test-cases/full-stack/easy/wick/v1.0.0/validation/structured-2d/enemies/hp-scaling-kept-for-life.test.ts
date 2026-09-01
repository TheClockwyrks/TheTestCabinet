// enemies/hp-scaling-kept-for-life — the health an enemy spawned with is the
// health it carries, whatever the clock does after.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Health scaling"): "A
// common enemy spawns with `maxHp = hp * hpMul(time)` and `hp = maxHp`, and
// keeps that `maxHp` for its life whatever the clock does afterward." A moth's
// table HP is `5` ("Common enemies") and `hpMul(59)` is `1`, since
// `floor(59 / 60)` is `0`, so a moth spawned at `SPAWN_TIME` (59 seconds)
// carries `maxHp` `5`. `hpMul(60)` is `1.15`, so a build that re-read the
// scaling on any later tick would have this moth at `5.75` the moment the
// clock passed the minute; the requirement is that it still reads `5`.
//
// WHY THE SPAN IS 61 TICKS. The moth spawns on the tick the clock reads
// `59 × 60 = 3540`. One second of ticks carries the clock to `3600`, the tick
// `time` reads `60` on and the first tick of the new multiplier, and one more
// carries it past. Sixty-one ticks is that crossing plus its far side.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding one moth, with
// every driver switch off: the clock rises on every tick whatever the switches
// hold ("One tick", phase 1), while no weapon fires at the moth, no contact
// touches it, no spawn or scripted event adds another enemy, and the moth does
// not move — so the only thing that changes across the span is the clock, and
// the only thing read is what the moth's `maxHp` did while it changed.
//
// THE TOLERANCE. `REAL_EPS`: the reading is one table value times a multiplier
// of `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { ENEMIES, hpMul, REAL_EPS, TICK_HZ } from "../constants";
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

/** The run clock the moth spawns on, in seconds: one short of the first minute. */
const SPAWN_TIME = 59;

/** Ticks run after the spawn: one second of them, and one more. */
const TICKS = TICK_HZ + 1;

/** `5 × 1`, the health the moth spawns with and must keep. */
const HEALTH = ENEMIES.moth.hp * hpMul(SPAWN_TIME);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves a moth spawned at 59 seconds reading 5 maxHp once the clock has passed 60", async () => {
  isolate(h);
  h.debug.setTick(SPAWN_TIME * TICK_HZ);
  const moth = placeEnemyNear(h, "moth", POST, 0);
  const spawned = requireEnemy(h.snapshot(), moth);
  assertNear(
    spawned.maxHp,
    HEALTH,
    REAL_EPS,
    "the maxHp the moth spawned with at a run clock of 59 seconds (specs/enemies.md, Health scaling)",
  );

  const crossed = await advanceTicks(h, TICKS);
  captureStill(h, "kept");
  const now = requireEnemy(crossed, moth);

  assertNear(
    crossed.run.time,
    SPAWN_TIME + TICKS / TICK_HZ,
    REAL_EPS,
    "the run clock after the span, which must have passed 60 for this to be a crossing",
  );
  assertNear(
    now.maxHp,
    HEALTH,
    REAL_EPS,
    "the moth's maxHp once the clock has passed the minute (specs/enemies.md, Health scaling)",
  );
  assertNear(
    now.hp,
    HEALTH,
    REAL_EPS,
    "the moth's hp once the clock has passed the minute (specs/enemies.md, Health scaling)",
  );
});
