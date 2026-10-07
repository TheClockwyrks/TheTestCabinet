// states/start-round — confirming the title's first item opens a round.
//
// specs/ui.md gives the title menu the mode's entry first and `HOW TO PLAY`
// second, and "`confirm` on it starts a round, which sets `screen` to `playing`".
// The title is opened fresh, so the highlight is on the first item as
// specs/ui.md requires of every menu-bearing screen, and `confirm` is a real key
// event dispatched at the listener the engine's keyboard reads: the transition is
// the build's own menu handling, driven from a press edge the way a player's is.
//
// What the round is laid out with is `states/round-lays-out-the-board`; this
// decides that the round opens at all.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The first key `specs/controls.md` binds to `confirm`. */
const CONFIRM = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets the screen to playing on confirm at the mode entry", async () => {
  const title = openTitle(h);
  assertEqual(title.screen, "title", "the screen the round is started from");
  assertEqual(title.menuIndex, 0, "the highlighted item");

  await h.tap(CONFIRM);
  captureStill(h, "playing");

  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen confirm on the mode entry opened",
  );
});
