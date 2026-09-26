// enemies/weave-anchor-chases — a weaver's anchor closes on the lamplighter at
// the row's speed.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Weave"): "A weaving
// enemy chases with an anchor and is drawn beside it. The anchor is what
// advances toward the lamplighter", and the tick's own order gives the step:
//
//   anchor   = position - perp(heading) * offset(age)
//   heading  = unit(lamplighter - anchor)
//   anchor   = anchor + heading * speed * TICK_DT
//
// A wisp's speed is `90` ("Common enemies") and one tick's step is
// `speed * TICK_DT` ("Movement"), so the anchor advances exactly `1.5` units a
// tick, along the unit vector from the anchor to the lamplighter's center.
// This check reads both across `TICKS` (60) ticks: every tick's anchor must
// stand `1.5` units from the previous tick's, in that direction.
//
// HOW THE ANCHOR IS READ. It is not a snapshot field, and the same section
// says how it is recovered: "The state carries the position and the heading,
// and the anchor is the position minus the offset at the current age."
// `enemies/roster`'s `stepPointOf` is that recovery, taken on the state as it
// stands before and after each tick, so the anchor read after a tick is the
// one that tick advanced.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding one wisp, with
// `enemyMotion` the one switch on, so the span is ticks of the weave and
// nothing else. The wisp is spawned `SPAWN` (500) units straight above the
// stationary lamplighter, where the offset is `0` and the anchor is the spawn
// point. Sixty ticks close `90` of those `500` units, so the anchor never
// reaches the lamplighter's center and the holding rule of
// `weave-holds-at-center` never applies. `enemyContact` is off, so the wisp's
// swing across the lamplighter lands no hit, and nothing else is alive.
//
// THE TOLERANCE. `MOTION_EPS` on the anchor after each tick, a point reached
// by recovering the anchor and integrating one step of `1.5` units.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { ENEMIES, MOTION_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  distance,
  enable,
  isolate,
  placeEnemyNear,
  unit,
  type Harness,
} from "../harness";
import { requireEnemy, stepPointOf } from "./roster";

/** How far above the lamplighter the wisp is spawned. */
const SPAWN = 500;

/** Ticks of the chase. */
const TICKS = 60;

/** One tick of a wisp's anchor, in units: `90 / 60`. */
const STEP = ENEMIES.wisp.speed * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("advances a wisp's anchor 1.5 units a tick toward the lamplighter across 60 ticks", async () => {
  isolate(h);
  const wisp = placeEnemyNear(h, "wisp", 0, -SPAWN);
  enable(h, "enemyMotion");

  await captureReplay(h, "anchor", async () => {
    for (let tick = 1; tick <= TICKS; tick += 1) {
      const before = h.snapshot();
      const anchor = stepPointOf(requireEnemy(before, wisp));
      const { player } = before.run;
      const heading = unit(player.x - anchor.x, player.y - anchor.y);
      const wanted = {
        x: anchor.x + heading.x * STEP,
        y: anchor.y + heading.y * STEP,
      };

      const moved = stepPointOf(requireEnemy(await advanceTicks(h, 1), wisp));
      assertLessThanOrEqual(
        distance(moved, wanted),
        MOTION_EPS,
        `tick ${tick}: how far the wisp's anchor lies from one ${STEP}-unit step toward the lamplighter's center (specs/enemies.md, Weave)`,
      );
    }
  });
});
