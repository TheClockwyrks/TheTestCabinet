// Wireworm — screens/pause-resume: confirming RESUME returns to play with the
// board exactly as the pause left it.
//
// One transition of the menu state machine `specs/ui.md` fixes: RESUME "returns
// to `playing` with the board and the run exactly as they were". What decides it
// is the worm that was on the board when the pause was raised: a build whose
// RESUME opens the level afresh sweeps it away or enters a new one somewhere
// else, and a build that resumes what it paused hands back the same worm on the
// same tile.
//
// THE WORM'S STEP CLOCK IS OFF. `setWormStepping` gates the step alone, so the
// worm holds the tile it was posed on for as long as the check runs. That is
// deliberate isolation, not convenience: what RESUME owes is the board it was
// handed back, and a worm free to step would make the reading depend on where a
// resumed step clock happens to land — which is `worm`'s business, and
// `screens/pause-freezes`'s.
//
// The pause is raised by the `pause` action's own first bound key (`KeyP`), and
// the accept is the `confirm` action's, both dispatched as real key events at
// the target the engine listens on. The highlight is posed onto RESUME with
// `setMenuIndex`, so a build whose pause menu opens on some other item is graded
// here on the transition rather than on where its highlight started.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  headOf,
  poseWorm,
  startPlaying,
  wormOf,
  type Harness,
} from "../harness";

/** Where the worm is posed: mid-board, clear of every wall. */
const WORM_C = 12;
const WORM_R = 7;

/** How many segments it carries — enough that a rebuilt level is unmistakable. */
const WORM_LENGTH = 4;

/** `pause`'s own first bound key; `KeyP` drives nothing else (specs/controls.md). */
const PAUSE_KEY = "KeyP";

/** `confirm`'s own bound key; `Enter` drives nothing else (specs/controls.md). */
const CONFIRM_KEY = "Enter";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resumes play with the worm on the tile it was paused on", async () => {
  startPlaying(h);
  const worm = poseWorm(h, WORM_C, WORM_R, WORM_LENGTH);
  h.debug.setWormStepping(worm, false);

  await h.tap(PAUSE_KEY);
  assertEqual(
    h.snapshot().screen,
    "paused",
    "the pause key opens the pause screen during live play (specs/ui.md)",
  );
  assertEqual(PAUSE_ITEMS[0], "RESUME", "RESUME is the first pause item");
  h.debug.setMenuIndex(0);
  assertEqual(
    h.snapshot().menuIndex,
    0,
    "the pause menu's highlight rests on RESUME before the confirm",
  );
  const pausedOn = headOf(wormOf(h.snapshot(), worm));

  await h.tap(CONFIRM_KEY);
  await h.advance(1);
  captureStill(h, "resumed");

  const resumed = h.snapshot();
  assertEqual(
    resumed.screen,
    "playing",
    "confirming RESUME returns to the playing screen (specs/ui.md)",
  );
  const resumedOn = headOf(wormOf(resumed, worm));
  assertEqual(
    resumedOn.c,
    pausedOn.c,
    "the resumed worm's head is in the column it was paused in " +
      "(specs/ui.md)",
  );
  assertEqual(
    resumedOn.r,
    pausedOn.r,
    "the resumed worm's head is on the row it was paused on (specs/ui.md)",
  );
});
