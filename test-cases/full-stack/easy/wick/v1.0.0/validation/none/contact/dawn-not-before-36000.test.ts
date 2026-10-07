// contact/dawn-not-before-36000 — the run plays on until tick 36000.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Fallen and dawn"): "Dawn |
// `tick` equals `DAWN_TIME x TICK_HZ` (`36000`). | `dawn`". The condition is
// equality with 36000, so tick 35999 ends nothing: the tick after a clock posed
// to 35998 leaves the run on `playing` at 35999. This is the other direction of
// `contact/dawn-at-36000`, posed deliberately one tick short, so a build whose
// dawn arrives a tick early fails here while a build that ends exactly at
// 36000 passes.
//
// THE DRIVE. An isolated night with every faculty held, nothing alive, and the
// clock posed to 35998 through `setTick`, which accepts any whole number "from
// `0` to `DAWN_TIME x TICK_HZ - 1`". One tick is run, and the screen and the
// clock are read off its snapshot. `hp` is at `BASE_MAX_HP` and nothing touches
// it, so the other ending has no way to fire.
//
// THE TOLERANCE. None: a tick count and a screen name are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DAWN_TICK } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The clock posed: two ticks short of dawn. */
const POSED_TICK = DAWN_TICK - 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the run on playing at tick 35999", async () => {
  await isolate(h);
  await h.debug.setTick(POSED_TICK);

  const after = await h.step(1);

  // The night still running on its last tick before dawn. Captured before the
  // assertions, so a failing build leaves the picture that shows why.
  await captureStill(h, "before");

  assertEqual(after.run.tick, POSED_TICK + 1, "the run clock after one tick");
  assertEqual(after.screen, "playing", "the screen on tick 35999");
});
