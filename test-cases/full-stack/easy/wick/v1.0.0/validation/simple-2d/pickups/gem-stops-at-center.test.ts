// pickups/gem-stops-at-center — a flight step stops at the lamplighter's
// center rather than carrying the gem past it.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Attraction and flight"): "An
// attracted gem moves toward the lamplighter's center each tick by
// `GEM_SPEED × TICK_DT`, stopping at the center rather than passing it. After
// it moves, a gem whose center is at most `COLLECT_RADIUS` from the
// lamplighter's center is collected on that tick". A step is `GEM_STEP` (10)
// units and `COLLECT_RADIUS` is 8, so the clamp is READ at a distance where
// passing the center would carry the gem out of collection range: from `POSED`
// (1) unit out, a build that stops lands the gem on the center, 0 units away,
// and collects it on that tick, while a build that steps the full 10 units
// lands it 9 units past the center, outside the 8 the collection rule allows,
// and the gem survives the tick uncollected. Every larger distance collects
// under both readings, so this is where the two part.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing else on the
// ground, no weapon and no passive held, every driver switch off, so nothing
// but the flight step can move the gem and nothing but the collection can
// remove it. The gem is latched attracted with `setGemAttracted`, so the tick
// it takes is a flight step rather than the tick that attracts it, and it lies
// along `+x` alone so the step is one axis wide. `progression` is one of the
// switches `isolate` holds off, so the collection opens no overlay over the
// reading.
//
// WHAT IS READ. After one tick: no gem left on the field, and `xp` risen by the
// tier's own figure, which together say the step ended on the center and the
// collection followed it.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on `xp`, "a real number" read back as a
// double; none on the gem count. The two readings are 9 units apart in the
// gem's position, seven orders above any rounding a step carries.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertUndefined, assertWithin } from "../assert";
import { COLLECT_RADIUS, FIGURE_TOLERANCE, GEM_VALUES } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";
import { GEM_STEP, gemById } from "./night";

/** Where the gem lies: a step past the center is 9 units, outside COLLECT_RADIUS. */
const POSED = 1;

/** The tier flown, and the experience specs/world.md gives it. */
const TIER = "small";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lands a gem 1 unit out on the center, so that tick collects it", async () => {
  const posed = isolate(h);
  const { player } = posed.run;
  const gem = spawnGemAt(h, TIER, player.x + POSED, player.y);
  h.debug.setGemAttracted(gem, true);

  const after = await h.tick(1);
  captureStill(h, "stopped");

  assertUndefined(
    gemById(after, gem),
    `the gem after the step, which ended on the center and inside ${COLLECT_RADIUS}`,
  );
  assertLength(after.run.gems, 0, "gems left after the flight step");
  assertWithin(
    after.run.xp - posed.run.xp,
    GEM_VALUES[TIER],
    FIGURE_TOLERANCE,
    `the experience the gem granted after a ${GEM_STEP}-unit step`,
  );
});
