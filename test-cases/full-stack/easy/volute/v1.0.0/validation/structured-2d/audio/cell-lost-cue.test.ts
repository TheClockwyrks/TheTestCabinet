// audio/cell-lost-cue — the cue a spent cell plays is `cell-lost`.
//
// THE SPEC LINE. `specs/ui.md` ("Audio"): `cell-lost` is played when "A cell
// is spent", and `specs/progression.md` fixes when that is: a core reaching
// the intake "spends a cell". `specs/assets.md` says what it is for — "heavy
// and final, the loudest bad news the game gives" — which is why the spend has
// a cue of its own rather than sharing the arrival's.
//
// THE SAME ARRIVAL, A DIFFERENT READING. `audio/intake-cue` drives the
// identical hall and reads `intake`; this one reads `cell-lost`. The two cues
// land on one tick, which `specs/ui.md` allows, and a build that plays only
// one of them has to fail exactly one of the two points.

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

it("sounds the cell-lost cue on the tick a cell is spent", async () => {
  await openHall(h);
  await poseHall(h, {
    level: 1,
    pressure: 0,
    cores: [[ARRIVAL_S, "halide", null]],
  });
  const posed = h.snapshot();

  const played = watchCues(h);
  const arrival = await captureReplay(h, "cell-lost", async () => {
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
    "cell-lost",
    "the cell-lost cue on the tick the cell was spent",
  );
});
