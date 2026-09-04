// lives/start-at-three — a fresh session opens holding 3 lives.
//
// specs/screens.md starts a session with the lives figure specs/field.md's
// life-loss check spends, and specs/instrumentation.md fixes the figure on the
// surface route this check takes: setScreen('playing') "starts a fresh session
// exactly as confirming START does: score `0`, `3` lives, wave `1` ...". The
// lives are first posed down to 1, so a session that merely inherits whatever
// lives stood is told apart from one that starts at 3.
//
// The menus stay untouched: the real key route into a session belongs to the
// screens checks.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { START_LIVES } from "../constants";
import { captureStill, openHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h.dispose();
});

it("starts a fresh session with 3 lives", async () => {
  h.reset();
  h.debug.setScreen("playing");
  // Disturb the figure, so the next session's 3 is the session start's own.
  h.debug.setLives(1);

  h.debug.setScreen("playing");
  const fresh = h.snapshot();

  await h.tick(1);
  captureStill(h, "fresh");

  assertEqual(
    fresh.lives,
    START_LIVES,
    "the lives a fresh session starts with",
  );
});
