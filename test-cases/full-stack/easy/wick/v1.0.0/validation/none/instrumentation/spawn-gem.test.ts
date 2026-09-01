// Wick — instrumentation/spawn-gem: `spawnGem("medium", 200, 0)` appears in
// the snapshot as a medium gem at `(200, 0)` with `attracted` `false` and the
// next id, and it stays put across 60 ticks with the lamplighter at the
// origin.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `spawnGem(tier, x, y)`): "Places one unattracted gem of `tier`, a
// `GemTier`, at `(x, y)` with the next id." specs/world.md — "Attraction and
// flight": "a gem whose center is at most `pickupRadius` from the
// lamplighter's center becomes attracted", and `pickupRadius` is 48 with no
// Lure held, so a gem 200 units away stays where it was dropped.
//
// WHY THE WORLD IS POSED AS IT IS. An empty night, so the next id is the one
// the snapshot held before the call; the lamplighter stands still at the
// origin with every faculty held, so nothing but attraction could move the
// gem, and it is out of range.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { POSITION_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  gemById,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

const AT = { x: 200, y: 0 };
const HELD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places an unattracted gem with the next id, which stays put", async () => {
  await isolate(h);
  const before = await h.snapshot();

  const gem = await placeGem(h, "medium", AT.x, AT.y);
  assertEqual(gem.id, before.run.nextId, "the gem's id, the next id");
  assertEqual(gem.tier, "medium", "the gem's tier");
  assertNear(gem.x, AT.x, POSITION_TOL, "the gem's x");
  assertNear(gem.y, AT.y, POSITION_TOL, "the gem's y");
  assertEqual(gem.attracted, false, "the gem's attraction");

  const later = await h.step(HELD_TICKS);
  await captureStill(h, "placed");
  const still = gemById(later, gem.id);
  assertNear(still?.x ?? NaN, AT.x, POSITION_TOL, `the gem's x after ${HELD_TICKS} ticks`);
  assertNear(still?.y ?? NaN, AT.y, POSITION_TOL, `the gem's y after ${HELD_TICKS} ticks`);
  assertEqual(still?.attracted, false, `the gem's attraction after ${HELD_TICKS} ticks`);
});
