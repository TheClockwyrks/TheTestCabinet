// navigation/gameover-back — Escape leaves the game-over screen for the title.
//
// specs/ui.md's transition table gives `"gameover"` two ways out: `MENU`
// confirmed, and `back`. They are two points because a build that wired only one
// of them must fail exactly the one it missed — an item that covered both would
// score the same for a build with one route out as for a build with neither.
//
// THE SELECTION IS DELIBERATELY LEFT ON `PLAY AGAIN`, the entry `specs/ui.md`
// puts the highlight on when the screen is arrived at. So a build that read
// `back` as a `confirm` of the standing selection opens a fresh dive's countdown
// rather than the title, and fails here rather than passing on the screen change
// it happened to make.
//
// The screen is reached through `setScreen` rather than by spending three lives,
// because reaching it is `scoring.three-lives`'s point and a longer route only
// adds failure modes. Nothing advances on `"gameover"` (specs/ui.md), so no
// bystander can move under the press.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The key specs/movement.md binds `back` to. */
const KEY = BINDINGS.back[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title when Escape is pressed on the game-over screen", async () => {
  await startPlaying(h);
  await h.debug.setScreen("gameover");
  assertEqual(
    (await h.snapshot()).screen,
    "gameover",
    "the screen the press is made on",
  );

  await h.tap(KEY);
  // Before the assertion, so a failing check still leaves the screen it read.
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen `back` pressed on the game-over screen reaches (specs/ui.md)",
  );
});
