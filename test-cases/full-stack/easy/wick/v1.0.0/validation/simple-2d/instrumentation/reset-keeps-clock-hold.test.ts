// instrumentation/reset-keeps-clock-hold — `reset()` leaves the game off real
// time: under this engine the harness's clock keeps driving frame by frame,
// so `run.tick` stays 0 until the scenario advances it.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "What the runtime
// provides instead": "a clock that supplies its own deltas takes it off real
// time: a scenario pairs a `ConstantClock` of `1000 / 60` milliseconds with
// `engine.advance`"; "A render-free core. Game state advances from ticks and
// input alone, independent ... of wall-clock time". A reset "leaves the game
// indistinguishable from a freshly started session", so nothing a reset does
// may put the game back on the wall clock; `reset()` restores "the `title`
// screen", where nothing ticks.
//
// THE READ. A run is posed and driven, then reset. `run.tick` reads 0 at the
// call, still 0 after frames the scenario runs on the title, and rises by
// exactly the frames the scenario advances once a run is posed: nothing
// advances it but the scenario. Nothing here waits on real time.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** Frames the scenario runs on the title after the reset. */
const TITLE_FRAMES = 5;

/** Frames the scenario advances on the run posed afterward. */
const DRIVEN = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps run.tick at 0 after reset until the scenario advances a run", async () => {
  isolate(h);
  await h.tick(10);

  h.reset();
  assertEqual(h.snapshot().run.tick, 0, "run.tick at the reset call");
  const frameBefore = h.frame();
  await h.advance(TITLE_FRAMES);
  const held = h.snapshot();
  assertEqual(
    h.frame() - frameBefore,
    TITLE_FRAMES,
    "frames the scenario drove on the title after reset",
  );
  assertEqual(held.run.tick, 0, "run.tick after frames on the title");

  h.debug.setScreen("playing");
  const driven = await h.tick(DRIVEN);
  captureStill(h, "held");
  assertEqual(driven.run.tick, DRIVEN, "run.tick after the scenario's frames");
});
