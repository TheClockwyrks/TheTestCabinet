// hud/clock-format — the run clock counts up as `m:ss`.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Clock | The run
// clock as `m:ss`, counting up from `0:00` in whole seconds, the seconds always
// two digits."
//
// THE FIGURES, AND WHERE THEY COME FROM. `specs/instrumentation.md` derives
// `time` as "`tick / TICK_HZ`", with `TICK_HZ` (`60`), and the format above
// turns that into minutes and whole seconds. So four ticks decide the whole
// rule:
//
//   tick   300 -> 5 seconds exactly          -> 0:05   the seconds' second digit
//   tick  4020 -> 67 seconds exactly         -> 1:07   the minute, and a padded
//                                                      second digit
//   tick  4050 -> 67.5 seconds               -> 1:07   whole seconds: a part
//                                                      second does not round up
//   tick 35999 -> 599.983 seconds            -> 9:59   the last tick of the night
//
// WHY THE CLOCK IS POSED ONE TICK SHORT. `setTick` "Sets `tick` to `tick`"
// and the frame that draws the HUD runs a tick of its own on `playing`
// (`specs/instrumentation.md`, "A deterministic core"), so each frame is posed at
// the tick before the one it is read at. The last of the four is why: at tick
// `36000` the run ends at dawn (`specs/world.md`, "Fallen and dawn"), so `35999`
// is the last tick a HUD is drawn on and it can only be reached by posing
// `35998` and running one tick.
//
// HOW THE CLOCK IS READ. `specs/ui.md` fixes no font and no layout, so a build
// may draw the clock as one run of text or glyph by glyph. `hud/readouts` groups
// the runs a frame laid down into the words their spacing makes and takes the
// maximal runs of digits and colons in each: `0:05` is found in a `0:05` and in
// a `TIME 0:05`, and neither a `10:05` nor a `0:050` answers for it. The format
// is exactly what the point asserts, so a clock reading `00:05` or `0:5` fails
// the two-digit rule the spec sentence states.
//
// WHY ONE HARNESS DRIVES ALL FOUR. Every driver switch is off on an isolated
// run, so the only thing that changes between the four frames is the clock this
// point poses.

import { afterEach, beforeEach, it } from "vitest";
import { LAST_TICK, TICK_HZ, clockText } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { drewClock } from "./readouts";

/** The four ticks the clock is read at, and what `m:ss` makes of each. */
const READINGS: readonly { tick: number; text: string }[] = [
  { tick: 5 * TICK_HZ, text: "0:05" },
  { tick: 67 * TICK_HZ, text: "1:07" },
  { tick: 67 * TICK_HZ + TICK_HZ / 2, text: "1:07" },
  { tick: LAST_TICK, text: "9:59" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the run clock as m:ss", async () => {
  isolate(h);

  for (const reading of READINGS) {
    h.debug.setTick(reading.tick - 1);
    const calls = await h.frameCalls();
    captureStill(h, "clock");

    const posed = h.snapshot();
    assertEqual(posed.screen, "playing", `the screen at tick ${reading.tick}`);
    assertEqual(
      posed.run.tick,
      reading.tick,
      "the tick the frame was drawn at",
    );
    assertEqual(
      clockText(reading.tick),
      reading.text,
      `the clock the format gives tick ${reading.tick}`,
    );

    assertTrue(
      drewClock(calls, reading.text),
      `the clock ${reading.text} drawn at tick ${reading.tick}`,
    );
  }
});
