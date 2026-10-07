// lives/start-at-three — a fresh session opens holding 3 lives.
//
// specs/screens.md starts a session with the lives figure specs/field.md's
// life-loss check spends, and specs/instrumentation.md fixes it on the boot
// state `reset` restores: "`3` lives". The lives are first posed down to 1, so a
// session that merely inherits whatever lives stood is told apart from one that
// starts at 3.
//
// The session is begun through the harness's own sequence of atomic poses, so
// the menus stay untouched: the real key route into a session belongs to the
// screens checks.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { START_LIVES } from "../constants";
import {
  captureStill,
  openHarness,
  startFreshSession,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a fresh session with 3 lives", async () => {
  await h.reset();
  await h.debug.setScreen("playing");
  // Disturb the figure, so the next session's 3 is the session start's own.
  await h.debug.setLives(1);

  const fresh = await startFreshSession(h);

  await h.tick(1);
  await captureStill(h, "fresh");

  assertEqual(
    fresh.lives,
    START_LIVES,
    "the lives a fresh session starts with",
  );
});
