// audio/intake-cue — the cue a core reaching the intake plays is `intake`.
//
// THE SPEC LINE. `specs/ui.md` ("Audio"): `intake` is played when "A core
// reaches the intake", and `specs/progression.md` fixes that as "A core whose
// arc position `s` reaches 5000".
//
// WHAT ALSO SOUNDS ON THAT TICK. The arrival spends a cell, and `specs/ui.md`
// binds `cell-lost` to that — so both sound on the one tick, which the same
// file allows: "a tick raising several different cues sounds each of them
// once". Which is exactly why the two are separate points: a build that
// rumbles for the intake and says nothing about the cell passes here and fails
// `audio/cell-lost-cue`. This one reads `intake` alone.
//
// THE HALL. One core posed 20 units short of the intake with the inlet held,
// so nothing joins it and nothing else on the channel can reach anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { INTAKE_S } from "../constants";
import {
  captureReplay,
  createHarness,
  poseHall,
  watchCues,
  type Harness,
} from "../harness";
import { assertHeardOnce, openHall } from "./cues";

/** Where the arriving core is posed: 20 units short of the intake. */
const ARRIVAL_S = INTAKE_S - 20;

/** Comfortably past the 55 ticks the ride takes at level 1's feed speed. */
const RIDE_TICKS = 120;

/** Ticks recorded after the arrival, so the clip shows what it cost. */
const TRAIL_TICKS = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the intake cue on the tick a core reaches the intake", async () => {
  await openHall(h);
  await poseHall(h, {
    level: 1,
    pressure: 0,
    cores: [[ARRIVAL_S, "halide", null]],
  });
  const posed = await h.snapshot();

  const played = watchCues(h);
  const arrival = await captureReplay(h, "intake", async () => {
    const swept = await h.stepUntil((s) => s.cells !== posed.cells, {
      maxTicks: RIDE_TICKS,
      poll: 1,
    });
    const measured = { swept, tick: h.tick(), cues: [...played] };
    await h.step(TRAIL_TICKS);
    return measured;
  });

  assertTrue(
    arrival.swept.hit,
    `a cell spent within ${RIDE_TICKS} ticks of a core posed 20 units short of the intake`,
  );
  assertEqual(
    arrival.swept.snapshot.cells,
    posed.cells - 1,
    "the cells remaining once the core was swallowed",
  );
  assertHeardOnce(
    arrival.cues,
    arrival.tick,
    "intake",
    "the intake cue on the tick the core was swallowed",
  );
});
