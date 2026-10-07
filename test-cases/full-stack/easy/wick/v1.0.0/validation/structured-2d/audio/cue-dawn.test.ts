// Wick — audio/cue-dawn: the tick that ends the run at dawn plays `dawn`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `dawn` to "The run ends at dawn", and "Each is played on the tick its event
// happens ... and at most once on that tick." `specs/world.md`, Fallen and
// dawn: the dawn row reads "`tick` equals `DAWN_TIME × TICK_HZ` (`36000`)"
// and sets `screen` to `dawn`. One ending on one tick is therefore exactly
// one `dawn`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing, with
// every driver switch off, the clock posed to `LAST_TICK` (`35999`) and one
// tick run, so the tick the cue is read on is the tick whose clock phase
// raises `tick` to `36000`. `setTick` "Sets `tick` to `tick` ... Nothing else
// changes", and a pose "sounds nothing", so the ending is the game's own rule
// reached from a posed clock.
//
// `hp` is untouched and full, so the fallen ending cannot take this tick
// instead, and every driver switch is off, so posing the clock past every
// scripted event fires none of them ("a clock posed past an event never
// fires it"). The world holds no enemy, projectile, zone, gem, or pickup, so
// the tick raises no other cue, and a tick that ends the run "opens no
// overlay".
//
// THE TOLERANCE. None: the specification fixes the cue to the tick of the
// ending and to at most one play on it, and the collector reads whole frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES, DAWN_TICK } from "../constants";
import {
  captureReplay,
  createHarness,
  endDawn,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays dawn once on the tick the run ends at dawn", async () => {
  await isolatedRun(h);

  const { result: after, played } = await captureReplay(h, "dawn", () =>
    cuesOf(h, () => endDawn(h)),
  );

  // The premise: the tick really was tick 36000 and really ended the run.
  assertEqual(
    after.run.tick,
    DAWN_TICK,
    "the clock the ending tick left (specs/world.md, Fallen and dawn)",
  );
  assertEqual(after.screen, "dawn", "the screen that tick ended on");

  assertEqual(
    heard(played, CUES.dawn),
    1,
    "dawn cues on the tick the run ended at dawn (specs/ui.md, Audio)",
  );
});
