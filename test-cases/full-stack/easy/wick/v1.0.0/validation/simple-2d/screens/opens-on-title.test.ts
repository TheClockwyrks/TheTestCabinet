// screens/opens-on-title — a fresh boot opens on the title screen.
//
// WHAT THIS DECIDES. One thing: the game a fresh boot stands up is the title
// screen with `menuIndex` 0 over the idle run. What `reset` puts the game back
// to is the instrumentation category's point; this one is about what the build
// OPENS on, before anything reset it.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`title`): "The game opens here, and the debug surface's
//   `reset` returns here", and "`menuIndex` is `0` on arriving".
//   specs/state.md ("The idle run"): "`run` holds the values below whenever
//   `screen` is `title`, `howto`, or `almanac`: `initialize` and `reset` build
//   them", with the table this check compares against, restated as `IDLE_RUN`
//   in `constants.ts`.
//   specs/state.md ("The contract"): "`initialize` builds the whole state in
//   one go, so every field is present by the time a frame can observe it."
//
// THE DRIVE. None. `createHarness` builds the engine over the build's game and
// reads the surface's `snapshot` once, before any frame ran and before any pose
// touched the state, and that reading is `h.boot`. Nothing is reset, so a build
// whose fresh page opened into a live run, or onto another screen, fails here
// even though its `reset` is perfect. One frame is run afterwards so the still
// the reviewer sees is a frame the build drew; a frame on `title` advances
// nothing (specs/ui.md, "What advances on each screen"), so it cannot change
// the reading.
//
// THE TOLERANCE. None: a screen name, a menu index, and the idle run's stored
// fields are all exact figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { IDLE_RUN } from "../constants";
import {
  captureStill,
  createHarness,
  present,
  runFields,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("opens on title with menuIndex 0 over the idle run", async () => {
  const boot = present(
    h.boot,
    "the snapshot of the state the build booted into",
  );

  await h.frameDraw(); // paint the title, so the still is a frame the build drew
  captureStill(h, "title");

  assertEqual(boot.screen, "title", "the screen a fresh boot opens on");
  assertEqual(boot.menuIndex, 0, "the highlight a fresh boot opens with");
  assertDeepEqual(
    runFields(boot.run),
    IDLE_RUN,
    "the run a fresh boot opens with, as specs/state.md's idle table fixes it",
  );
});
