// scoring/session-starts-fresh — a newly loaded game knows nothing of the session
// before it.
//
// specs/scoring.md: "A fresh session starts it at `0`", and both it and
// specs/ui.md put persistence of the score, the best score and any setting
// between sessions out of scope. So a best earned in one session is gone from the
// next.
//
// WHAT A SECOND SESSION IS UNDER THIS ENGINE. A second harness: a second engine,
// over a canvas of its own, whose `initialize` calls the build's own `initialize`
// exactly as the page does at load. Nothing crosses between two of them except
// what the build itself put outside its state — a module-level figure, a value
// cached in the module the game was imported from — which is precisely the
// carrying this point forbids. A harness never resets the game before it hands it
// over, so the first thing read off the second one is the state a LOAD leaves
// rather than the state a reset restores; reading it after a reset would decide
// nothing, because specs/instrumentation.md has a reset restore the best to `0`
// whatever the build carried across.
//
// The best of the first session is EARNED rather than posted: the score is posed
// above the best a session opens on and specs/scoring.md then raises the best to
// it, so what the second session is asked to have forgotten really was there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";

/** The best the first session reaches. */
const EARNED = 760;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a second session of the same build at a best of zero", async () => {
  poseScene(h, { score: EARNED, travel: false });
  await h.advance(1);
  assertEqual(h.snapshot().best, EARNED, "the best the first session reached");

  const fresh = await createHarness();
  try {
    // Read before anything at all touches the second session, then run the one
    // frame the still is taken off.
    const opened = fresh.snapshot();
    await fresh.advance(1);
    captureStill(fresh, "fresh");

    assertEqual(
      opened.screen,
      "title",
      "the screen the second session loaded on",
    );
    assertEqual(opened.best, 0, "the best a newly loaded game opens at");
    assertEqual(opened.score, 0, "the score a newly loaded game opens at");
  } finally {
    fresh.dispose();
  }
});
