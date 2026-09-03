// instrumentation/set-gem-attracted — `setGemAttracted(id, true)` on a gem
// 200 units away reads back attracted true, and on the next tick the gem has
// flown 10 units toward the lamplighter.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setGemAttracted`:
// "Sets gem `id`'s `attracted` to `attracted`, a boolean". specs/world.md,
// "Attraction and flight": "An attracted gem moves toward the lamplighter's
// center each tick by `GEM_SPEED × TICK_DT`", 600 / 60 = 10; phase 9: "every
// attracted gem that existed before this tick moves".
//
// THE POSE. An isolated run, a gem at (200, 0) with the lamplighter at the
// origin, the pose read back, and one tick: the gem at x 190, at
// MOTION_TOLERANCE.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertWithin } from "../assert";
import { GEM_SPEED, MOTION_TOLERANCE, TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  spawnGemAt,
  type Harness,
} from "../harness";

const AT = { x: 200, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("attracts the gem and it flies on the next tick", async () => {
  isolate(h);
  const id = spawnGemAt(h, "small", AT.x, AT.y);

  h.debug.setGemAttracted(id, true);
  const posed = h.snapshot().run.gems.find((gem) => gem.id === id);
  assertDefined(posed, "the gem after the pose");
  assertEqual(posed?.attracted, true, "attracted read back");
  assertEqual(posed?.x, AT.x, "x at the pose");

  const moved = await captureReplay(h, "attracted", () => h.tick(1));
  const gem = moved.run.gems.find((entry) => entry.id === id);
  assertDefined(gem, "the gem after the tick");
  assertWithin(
    gem?.x ?? Number.NaN,
    AT.x - GEM_SPEED * TICK_DT,
    MOTION_TOLERANCE,
    "x after one flight step",
  );
  assertWithin(
    gem?.y ?? Number.NaN,
    AT.y,
    MOTION_TOLERANCE,
    "y after one flight step",
  );
});
