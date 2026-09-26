// contact/dawn-not-before-36000 — the run is still playing on tick 35999.
//
// THE SPEC LINE. `specs/world.md`, "Fallen and dawn", the Dawn row: condition
// "`tick` equals `DAWN_TIME × TICK_HZ` (`36000`)". Equals, so the tick before
// it ends nothing; `dawn-at-36000` is the other direction of the same bound,
// and a build that ends the night at `tick >= 35999`, or on `time >= 600`
// computed from a clock one tick ahead, fails here and passes there.
//
// THE POSE. `setTick(35998)`, so the next tick raises the clock to `35999`,
// the last tick before dawn, and phase 11 finds neither condition: `hp` is
// full, the world is empty, every switch is off, so nothing but the clock is
// in play. The reading is that the screen is still `playing` and the tick is
// `35999`.
//
// THE TOLERANCE. A screen name and a tick count, exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LAST_TICK } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The clock posed two short of dawn, so one tick lands one short. */
const POSED_TICK = LAST_TICK - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves the run on playing at tick 35999", async () => {
  isolate(h);
  h.debug.setTick(POSED_TICK);
  assertEqual(h.snapshot().run.tick, POSED_TICK, "the clock posed to 35998");

  const after = await advanceTicks(h, 1);
  captureStill(h, "before");

  assertEqual(
    after.run.tick,
    LAST_TICK,
    "the clock after one tick from 35998 (specs/world.md, One tick)",
  );
  assertEqual(
    after.screen,
    "playing",
    `the screen at the end of tick ${LAST_TICK} (specs/world.md, Fallen and dawn)`,
  );
});
