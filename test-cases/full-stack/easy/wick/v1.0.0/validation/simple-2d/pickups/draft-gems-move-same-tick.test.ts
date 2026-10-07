// pickups/draft-gems-move-same-tick — a gem a draft attracts takes its flight
// step on the tick of the draft.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("One tick") puts the pickups
// in phase 8, "Every pickup meeting the collection condition is collected", and
// the gems in phase 9, after them: "Every gem within `pickupRadius` becomes
// attracted, every attracted gem that existed before this tick moves, and every
// gem within `COLLECT_RADIUS` is collected, this tick's drops and the gems a
// draft attracted on this tick included." The gem posed here existed before the
// tick, so the draft collected in phase 8 leaves it attracted in time for phase
// 9's move, and ("Attraction and flight") gives that move `GEM_SPEED × TICK_DT`,
// `GEM_STEP` (10) units toward the lamplighter's center. So a gem `POSED` (200)
// units out stands 190 units out in the snapshot of the tick that collected the
// draft.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing else on the
// ground, no weapon and no passive held, every driver switch off, so nothing
// else can attract or move the gem. The gem lies 200 units along `+x`, far
// outside `PICKUP_RADIUS` (48), so without the draft it would neither be
// attracted nor move at all, and 190 is far outside `COLLECT_RADIUS` (8), so
// the tick ends with the gem still on the field to be read. The draft lies on
// the lamplighter's own center, distance 0, so phase 8 takes it on this tick.
// The lamplighter never moves, so the step is one axis wide.
//
// WHAT IS READ. The gem's position in the snapshot of that single tick, 190
// units from the lamplighter along the axis it was placed on, and its
// `attracted` true. A build that leaves a draft's gems for the next tick reads
// 200.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on the coordinates, the case's allowance
// for a position carried through one integrated step; none on `attracted`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import { MOTION_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  spawnGemAt,
  spawnPickupAt,
  type Harness,
} from "../harness";
import { GEM_STEP, gemOf } from "./night";

/** Where the gem lies: far outside PICKUP_RADIUS, so only the draft reaches it. */
const POSED = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves a gem 200 units out 10 units in on the tick that collected the draft", async () => {
  const p = isolate(h);
  const { player } = p.run;
  const gem = spawnGemAt(h, "small", player.x + POSED, player.y);
  spawnPickupAt(h, "draft", player.x, player.y);

  const after = await h.tick(1);
  captureStill(h, "moved");

  assertLength(after.run.pickups, 0, "pickups left after the collecting tick");
  const seen = gemOf(after, gem);
  assertEqual(seen.attracted, true, "the gem's attracted flag after the draft");
  assertWithin(
    seen.x,
    player.x + POSED - GEM_STEP,
    MOTION_TOLERANCE,
    "the gem's x on the tick the draft was collected, in units",
  );
  assertWithin(
    seen.y,
    player.y,
    MOTION_TOLERANCE,
    "the gem's y on the tick the draft was collected, in units",
  );
});
