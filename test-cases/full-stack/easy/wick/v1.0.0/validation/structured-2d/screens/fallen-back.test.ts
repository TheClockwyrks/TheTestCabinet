// Wick — screens/fallen-back: `back` on the fallen screen returns to the
// title with the run discarded.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`fallen` and
// `dawn`": "`back` does what `TITLE` does", and `TITLE` "returns to `title`
// with `menuIndex = 0`". `specs/controls.md` gives the `fallen`, `dawn` row
// "`back` returns to `title`" and binds `back` to `Escape`.
// `specs/state.md`, "The idle run", says "leaving a run for the title
// restores" the idle values, the table this suite spells as `IDLE_RUN`.
//
// THE DRIVE. An isolated `playing` run with every driver switch off, its
// level and its kill count posed so an idle or a fresh run is unmistakable,
// ended fallen by posing `hp` to `0` and running the one tick
// `specs/world.md` ends the run on. Then one real `Escape`, with
// the highlight left where the arrival put it, since `back` is not a menu
// choice and must act whatever the highlight is on.
//
// THE TOLERANCE. None: a screen name, an index, and a run compared field for
// field against the idle run.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  IDLE_RUN,
  captureStill,
  createHarness,
  endFallen,
  isolate,
  tap,
  type Harness,
} from "../harness";

/** The ended run's figures, none of which the idle run carries. */
const LEVEL = 6;
const KILLS = 143;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads title with menuIndex 0 and the idle run after Escape", async () => {
  isolate(h);
  h.debug.setLevel(LEVEL);
  h.debug.setKills(KILLS);
  const ended = await endFallen(h);
  assertEqual(ended.screen, "fallen", "the screen the press is made on");
  assertEqual(ended.run.kills, KILLS, "the kills the ended run reports");

  const after = await tap(h, "Escape");
  captureStill(h, "back");

  assertEqual(after.screen, "title", "the screen after Escape");
  assertEqual(after.menuIndex, 0, "menuIndex on arriving at the title");
  assertDeepEqual(
    after.run,
    IDLE_RUN,
    "the run on the title screen (specs/state.md, The idle run)",
  );
});
