// clock/ended-run-ticks-no-further — an ended run ticks no further, fallen or
// at dawn.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Fallen and dawn"): "A run
// that has ended ticks no further." specs/ui.md ("What advances on each
// screen"): on `fallen` and `dawn`, "Nothing." The two endings are the same
// section's: "Dawn | `tick` equals `DAWN_TIME × TICK_HZ` (`36000`)" and
// "Fallen | `hp` is `0` or below", each "at the end of a tick, after every
// other phase of that tick has been applied", and specs/instrumentation.md's
// `setHp` and `setTick` pose each condition: `hp` at `0` "ends the run fallen
// at the end of the next `playing` tick", and `setTick` takes "a whole number
// from `0` to `DAWN_TIME × TICK_HZ − 1` (`35999`)", the tick before dawn.
//
// THE DRIVE. The live night of `./stage` twice: once with `hp` posed to `0`,
// once with the clock posed to `35999`, each followed by the one tick that
// ends the run and then sixty frames on the end screen. The ending tick runs
// every phase before it ends, so the moth, the bolt, and the gem each take one
// step and the timers count once, and that is the state the end screen holds:
// `run` after the sixty frames is `run` as the ending tick left it. A build
// that kept ticking moves six figures.
//
// THE TOLERANCE. None: a world that ticked nothing holds identical numbers, so
// the comparison is `assertDeepEqual` over the whole of `run`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { DAWN_TICK, MAX_POSED_TICK } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseLiveNight } from "./stage";

/** The frames run on each end screen: a second of wall-clock frames. */
const HELD_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ticks no further after falling and after dawn", async () => {
  await poseLiveNight(h);
  await h.debug.setHp(0);
  const fallen = await h.step(1);
  const fallenHeld = await h.step(HELD_FRAMES);

  await poseLiveNight(h);
  await h.debug.setTick(MAX_POSED_TICK);
  const dawn = await h.step(1);
  const dawnHeld = await h.step(HELD_FRAMES);
  await captureStill(h, "ended");

  assertEqual(fallen.screen, "fallen", "the screen the tick with hp at 0 left");
  assertEqual(
    fallenHeld.screen,
    "fallen",
    "the screen after 60 frames on fallen",
  );
  assertDeepEqual(
    fallenHeld.run,
    fallen.run,
    "the run after 60 frames on fallen, against the run the ending tick left",
  );

  assertEqual(
    dawn.screen,
    "dawn",
    "the screen the tick that reached dawn left",
  );
  assertEqual(dawn.run.tick, DAWN_TICK, "run.tick on dawn");
  assertEqual(dawnHeld.screen, "dawn", "the screen after 60 frames on dawn");
  assertDeepEqual(
    dawnHeld.run,
    dawn.run,
    "the run after 60 frames on dawn, against the run the ending tick left",
  );
});
