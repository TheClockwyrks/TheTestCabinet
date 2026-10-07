// instrumentation/set-screen-playing — `setScreen('playing')` from title,
// howto, fallen, or dawn stands the game on playing with menuIndex 0.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`: "Sets
// `screen` to `name`, one of the `Screen` values, with `menuIndex`,
// `almanacTab`, and `almanacScroll` all `0`", and "Applies on every screen".
// The pose begins no run: "a run is never begun, discarded, ended, or grown by
// it". What a fresh run is instead is `screens/fresh-run-state`, over the real
// `LIGHT THE LAMP`.
//
// THE POSE. Four screens, because `playing` is the one screen a build is most
// likely to have reached through a transition of its own: the two menus a reset
// and its own pose leave, and the two end screens a run ends on. The end
// screens are reached the real way, `hp` at `0` and the clock at its last tick,
// so the game stands where a finished run leaves it.
//
// THE TOLERANCE. None: a screen name and a menu index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  endDawn,
  endFallen,
  isolate,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** `setScreen("playing")` from the screen the game stands on, read back. */
function requirePlaying(from: string): void {
  h.debug.setScreen("playing");
  const playing = h.snapshot();
  assertEqual(
    playing.screen,
    "playing",
    `the screen after setScreen('playing') from ${from}`,
  );
  assertEqual(
    playing.menuIndex,
    0,
    `menuIndex after setScreen('playing') from ${from}`,
  );
}

it("stands the game on playing from title, howto, fallen, and dawn", async () => {
  h.reset();
  requirePlaying("title");

  h.reset();
  h.debug.setScreen("howto");
  requirePlaying("howto");

  isolate(h);
  const fallen = await endFallen(h);
  assertEqual(fallen.screen, "fallen", "the screen the ending tick left");
  requirePlaying("fallen");

  isolate(h);
  const dawn = await endDawn(h);
  assertEqual(dawn.screen, "dawn", "the screen the tick at dawn left");
  requirePlaying("dawn");
  captureStill(h, "playing");
});
