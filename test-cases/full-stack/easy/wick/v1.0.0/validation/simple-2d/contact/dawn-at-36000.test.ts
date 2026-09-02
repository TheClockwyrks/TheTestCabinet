// contact/dawn-at-36000 — the tick that carries the clock to
// DAWN_TIME × TICK_HZ (36000) ends the run at dawn: screen dawn, menuIndex 0.
//
// THE RULE, FROM THE SPEC. specs/world.md, Fallen and dawn: "A run ends at the
// end of a tick, after every other phase of that tick has been applied", with
// the Dawn row "tick equals DAWN_TIME × TICK_HZ (36000)" giving screen dawn,
// and DAWN_TIME 600. specs/ui.md, fallen and dawn: "menuIndex is 0 on
// arriving."
//
// THE POSE. An isolated night with the clock posed to 35999 through setTick,
// the top of its domain, "0 to DAWN_TIME × TICK_HZ − 1 (35999)"
// (specs/instrumentation.md). Phase 1 of the next tick raises it to 36000 and
// phase 11 reads it. Nothing else is on the field and every switch is off, so
// nothing but the clock can end the run. The replay runs on for a few frames
// after the ending so the end screen is what it shows.
//
// THE TOLERANCE. None: the screen, the menu index, and the tick are discrete.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DAWN_TICK } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The last tick of the night, one short of dawn. */
const POSED_TICK = DAWN_TICK - 1;

/** Frames of the end screen kept in the replay after the ending tick. */
const AFTERMATH_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the run at dawn on the tick the clock reaches 36000", async () => {
  isolate(h);
  h.debug.setTick(POSED_TICK);
  assertEqual(h.snapshot().run.tick, POSED_TICK, "the clock as posed");

  const ended = await captureReplay(h, "dawn", async () => {
    const after = await h.tick(1);
    await h.advance(AFTERMATH_FRAMES);
    return after;
  });

  assertEqual(ended.run.tick, DAWN_TICK, "the tick the run ended on");
  assertEqual(ended.screen, "dawn", "screen after the tick that reached dawn");
  assertEqual(ended.menuIndex, 0, "menuIndex on arriving at dawn");
});
