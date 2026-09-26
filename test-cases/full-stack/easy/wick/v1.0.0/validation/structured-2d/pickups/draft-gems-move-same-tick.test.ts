// pickups/draft-gems-move-same-tick — a gem a draft attracts flies on the
// draft's own tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("One tick") orders the two
// phases: phase 8, "Every pickup meeting the collection condition is
// collected", and phase 9, "Every gem within `pickupRadius` becomes attracted,
// every attracted gem that existed before this tick moves, and every gem within
// `COLLECT_RADIUS` is collected, this tick's drops and the gems a draft
// attracted on this tick included." The draft is collected before the gems are
// moved, and the gem was posed before the tick, so it takes a flight step on
// the very tick the draft was collected: `GEM_SPEED × TICK_DT` = `GEM_STEP`
// (`10`) units toward the lamplighter's center ("Attraction and flight"). A gem
// posed `POSED_DISTANCE` (`200`) units out along `+x` therefore stands at `190`
// in the snapshot that tick leaves, and a build that lets a draft's gems wait a
// tick reads `200`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so nothing else
// attracts or moves the gem. `POSED_DISTANCE` is far outside `PICKUP_RADIUS`
// (`48`), so the radius rule cannot attract the gem and the draft is the only
// thing that can; it is also far beyond `COLLECT_RADIUS` (`8`), so the gem
// survives the tick to be read. The draft is posed on the lamplighter's own
// center, at distance `0`, so one tick collects it with no movement. No key is
// pressed, so the lamplighter holds the origin and the whole step lies along
// one axis.
//
// THE TOLERANCE. `MOTION_EPS` (`1e-6`) on the position after one step; the step
// itself is exact and a build off by a whole step is off by `10` units.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertNear } from "../assert";
import { GEM_SPEED, MOTION_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  gemById,
  isolate,
  placeGem,
  placePickup,
  type Harness,
} from "../harness";

/** One tick's flight: `GEM_SPEED × TICK_DT` = `10` units. */
const GEM_STEP = GEM_SPEED * TICK_DT;

/** Far outside `PICKUP_RADIUS`, so only the draft can attract this gem. */
const POSED_DISTANCE = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has the gem 10 units closer in the snapshot of the tick that collected the draft", async () => {
  const opened = isolate(h);
  const at = opened.run.player;
  const gem = placeGem(h, "small", at.x + POSED_DISTANCE, at.y);
  placePickup(h, "draft", at.x, at.y);

  const after = await advanceTicks(h, 1);
  captureStill(h, "moved");

  assertEqual(
    after.run.pickups.length,
    0,
    "the pickups left after the tick, so the draft was collected",
  );
  const seen = gemById(after, gem);
  assertDefined(seen, "the gem after the tick that collected the draft");
  assertEqual(
    seen?.attracted,
    true,
    "the attracted flag the draft set (specs/world.md, Pickups)",
  );
  assertNear(
    seen?.x ?? NaN,
    at.x + POSED_DISTANCE - GEM_STEP,
    MOTION_EPS,
    "the gem's x on the draft's own tick, in units (specs/world.md, One tick, phase 9)",
  );
  assertNear(
    seen?.y ?? NaN,
    at.y,
    MOTION_EPS,
    "the gem's y on the draft's own tick, in units",
  );
});
