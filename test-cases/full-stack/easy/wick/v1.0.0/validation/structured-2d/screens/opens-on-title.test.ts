// Wick — screens/opens-on-title: a fresh boot stands on the title screen with
// the idle run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`title`": "The game
// opens here", and "`menuIndex` is `0` on arriving". `specs/state.md`, "The
// idle run": "`run` holds the values below whenever `screen` is `title`,
// `howto`, or `almanac`: `initialize` and `reset` build them", the table this
// suite spells as `IDLE_RUN`. `specs/instrumentation.md`, Snapshot shape:
// "`run` reports the idle run of `specs/state.md` on `title`, `howto`, and
// `almanac`".
//
// THE DRIVE. None at all, which is the point: the harness opens the engine,
// the build's `initialize` runs, and the very first snapshot is read with no
// `reset`, no pose, and no frame in between — so what is read is the state the
// build BOOTS on rather than one an operation restored. A frame is drawn after
// the reading, for the still alone.
//
// THE TOLERANCE. None: a screen name, an index, and a run compared field for
// field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  IDLE_RUN,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("boots on title with menuIndex 0 and the idle run", async () => {
  const boot = h.snapshot();

  await h.frameDraw();
  captureStill(h, "title");

  assertEqual(boot.screen, "title", "the screen a fresh boot opens on");
  assertEqual(boot.menuIndex, 0, "menuIndex on arriving at the title screen");
  assertDeepEqual(
    boot.run,
    IDLE_RUN,
    "run on the title screen (specs/state.md, The idle run)",
  );
});
