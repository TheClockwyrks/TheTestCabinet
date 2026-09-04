// audio/danger-bed-swap — the bed swaps on the tick the run turns dangerous.
//
// THE SPEC LINE. `specs/ui.md` ("The music beds"): "`hall-loop` and
// `danger-loop` are the two beds, and they loop until stopped rather than
// playing once. Exactly one of them is looping on `playing`", the table
// beneath it gives `danger-loop` to "The run is in danger" and `hall-loop` to
// "Otherwise", and: "The change happens on the tick the danger condition
// changes: the running bed stops and the other starts at once, so the two
// never sound together." `specs/progression.md` fixes danger as the head
// standing at `DANGER_S` (4000) or beyond.
//
// WHAT IS READ, AND WHY IT IS THE WHOLE OF THE RULE. Two things on the one
// tick: that `danger-loop` STARTED looping on it, and that exactly one bed is
// looping afterwards. Together those say the swap happened on the right tick
// and that the bed it replaced went silent — a build that starts the danger
// bed over a `hall-loop` it never stopped leaves two running and fails the
// second reading.
//
// THE HALL. One core posed 30 units short of the danger line with the inlet
// held, and the hall bed already up before the watch opens, so the only loop
// that can start inside the reading is the one the swap starts. That the
// danger read itself turns over at 4000 is `progression/danger-threshold`'s
// point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { DANGER_S } from "../constants";
import {
  captureReplay,
  createHarness,
  poseHall,
  watchCues,
  type Harness,
} from "../harness";
import { assertHeardOnce, assertOneBedLooping, openHall } from "./cues";

/** How far short of the danger line the core is posed, in arc units. */
const MARGIN = 30;

/** Comfortably past the 82 ticks the 30 units take at level 1's feed speed. */
const RIDE_TICKS = 180;

/** Ticks recorded after the swap, so the clip shows the hall it left. */
const TRAIL_TICKS = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts the danger bed on the tick the head reaches the danger line", async () => {
  await openHall(h);
  await poseHall(h, {
    level: 1,
    pressure: 0,
    cores: [[DANGER_S - MARGIN, "halide", null]],
  });
  const settled = await h.step(1);
  assertEqual(settled.danger, false, "the danger read before the crossing");
  await assertOneBedLooping(h, "the beds looping before the crossing");

  const played = watchCues(h);
  const crossing = await captureReplay(h, "swap", async () => {
    const swept = await h.stepUntil((s) => s.danger, {
      maxTicks: RIDE_TICKS,
      poll: 1,
    });
    const measured = { swept, tick: h.tick(), cues: [...played] };
    await h.step(TRAIL_TICKS);
    return measured;
  });

  assertTrue(
    crossing.swept.hit,
    `the head to reach ${DANGER_S} within ${RIDE_TICKS} ticks`,
  );
  assertHeardOnce(
    crossing.cues,
    crossing.tick,
    "danger-loop",
    "the danger bed starting on the tick the run turned dangerous",
  );
  await assertOneBedLooping(h, "the beds looping after the crossing");
});
