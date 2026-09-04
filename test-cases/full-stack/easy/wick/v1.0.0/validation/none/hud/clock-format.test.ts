// hud/clock-format — the clock counts up as `m:ss`.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Clock | The run
// clock as `m:ss`, counting up from `0:00` in whole seconds, the seconds always
// two digits".
//
// THE FIGURES, AND WHERE EACH COMES FROM. The run clock is `tick / TICK_HZ`
// seconds (specs/instrumentation.md — "Snapshot shape"), so the four ticks below
// read off that formula and the format the sentence above fixes:
//
//   - `300` is `5` seconds: `0:05`, which is the two-digit rule, since `0:5`
//     reads the seconds with one digit.
//   - `4020` is `67` seconds: `1:07`, which is the minute rule and the two-digit
//     rule together.
//   - `4050` is `67.5` seconds: `1:07` still, which is "in whole seconds".
//   - `35999` is `599.98` seconds: `9:59`, the last tick before dawn, since
//     `setTick` takes a tick up to `DAWN_TIME x TICK_HZ - 1`.
//
// WHY EACH FRAME IS DRAWN ONE TICK PAST THE POSE. `specs/world.md` — "One tick":
// phase 1 is "The clock. `tick` rises by one, and every phase below reads the new
// value", and the frame renders after the tick it ran, so the frame that draws
// tick `t` is the one stepped from a clock posed at `t - 1`. `setTick` "Sets
// `tick` to `tick`. Nothing else changes", and the night holds every driver
// switch, so nothing else on the HUD moves between the four readings.
//
// HOW THE CLOCK IS READ. `specs/ui.md` fixes no font and no layout, so the runs
// of text the frame drew are grouped into the words their spacing makes, and the
// clock is a maximal run of digits and colons in some word: a build that draws
// `0:05` alone, one that draws `TIME 0:05`, and one that lays each glyph down on
// its own all answer, and neither `10:05` nor `0:050` answers for `0:05`.

import { afterEach, beforeEach, it } from "vitest";
import { clockText, MAX_POSED_TICK, TICK_HZ } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import type { DrawCall } from "../harness";
import { drawnWords, drewClock } from "./readouts";
import { poseNight } from "./stage";

/** The four ticks the format is read at, each with the clock it must draw. */
const READINGS: readonly { tick: number; clock: string }[] = [
  { tick: 5 * TICK_HZ, clock: "0:05" },
  { tick: 67 * TICK_HZ, clock: "1:07" },
  { tick: 67 * TICK_HZ + TICK_HZ / 2, clock: "1:07" },
  { tick: MAX_POSED_TICK, clock: "9:59" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the run clock as minutes and two-digit whole seconds", async () => {
  await poseNight(h);

  const drawn: { tick: number; clock: string; calls: DrawCall[] }[] = [];
  for (const reading of READINGS) {
    await h.debug.setTick(reading.tick - 1);
    const posed = await h.step(1);
    assertEqual(posed.run.tick, reading.tick, "the tick the frame drew");
    drawn.push({ ...reading, calls: await h.lastCalls() });
  }
  await captureStill(h, "clock");

  for (const reading of drawn) {
    assertEqual(
      clockText(reading.tick),
      reading.clock,
      `the clock tick ${reading.tick} reads, by the specification's own formula`,
    );
    assertTrue(
      drewClock(reading.calls, reading.clock),
      `${reading.clock} drawn on the HUD at tick ${reading.tick} (the words drawn were ${JSON.stringify(
        drawnWords(reading.calls),
      )})`,
    );
  }
});
