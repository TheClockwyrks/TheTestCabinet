// Wick — instrumentation/reset-keeps-clock-hold: `reset()` leaves the game off
// real time when a scenario has taken it off.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "What
// the runtime provides instead": "a clock that supplies its own deltas takes it
// off real time: a scenario pairs a `ConstantClock` of `1000 / 60`
// milliseconds with `engine.advance`" — under this engine the hold IS the
// harness's scripted clock, which `reset` cannot touch, so the item's engine
// reading is "the harness clock keeps driving frame by frame, so `run.tick`
// stays 0 until the scenario advances it". `reset()` restores "the
// `title` screen", and `specs/ui.md`: on `title` "Nothing" advances.
//
// THE DRIVE. A run posed and ticked, then reset. `run.tick` reads 0 at the
// call, still 0 after frames the scenario runs on the title, and rises by
// exactly the frames the scenario advances once a run is posed — nothing
// advances it but the scenario.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

const TITLE_FRAMES = 5;
const RUN_TICKS = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps run.tick at 0 after reset until the scenario advances a run", async () => {
  isolate(h);
  await advanceTicks(h, 30);

  h.reset();
  assertEqual(h.snapshot().run.tick, 0, "run.tick at the reset call");
  const frameBefore = h.frame();
  await h.advance(TITLE_FRAMES);
  const held = h.snapshot();
  await h.frameDraw();
  captureStill(h, "held");
  assertEqual(
    h.frame() - frameBefore,
    TITLE_FRAMES + 1,
    "frames the scenario drove after reset",
  );
  assertEqual(held.run.tick, 0, "run.tick after frames on the title");

  h.debug.setScreen("playing");
  const run = await advanceTicks(h, RUN_TICKS);
  assertEqual(
    run.run.tick,
    RUN_TICKS,
    "run.tick after the scenario advanced it",
  );
});
