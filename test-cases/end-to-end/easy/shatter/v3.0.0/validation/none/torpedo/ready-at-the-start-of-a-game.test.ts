// torpedo/ready-at-the-start-of-a-game — a game opens with the torpedo charged.
//
// specs/weapons.md, "The charge": "The ship holds one torpedo charge, a number
// from `0` to `1`. A game begins with the charge at `1`, ready to fire." And
// specs/instrumentation.md fixes the reading: `torpedoCharge` is the stored
// number, and `torpedoReady` is `true` exactly when that charge is `1`. So the
// opening state is two readings of one rule, and both are taken here.
//
// THE GAME IS OPENED THE WAY A PLAYER OPENS ONE, and it has to be. No pose can
// produce a new game: `setTorpedoCharge` would set the very number under test, so
// a check that posed it would compare the build against the check. `reset()` puts
// the build back on the title, `PLAY` is confirmed with a real key through
// Chromium's input pipeline, and what is read afterwards is what the build's own
// new-game path built. That route leaves both world gates on — `reset` restores
// them — so this is a real opening wave, which is the point.
//
// THE SCREEN IS CONFIRMED BEFORE THE CHARGE IS READ. A build that never left the
// title has not begun a game at all, and "a game begins with the charge at 1" is
// not decidable against one that never did; the check names that as what it needed
// rather than reading a title screen's charge and calling it an opening.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  startGameFromTitle,
  type Harness,
} from "../harness";
import { chargeOf, readyOf } from "./scene";

/** The charge a game opens on (`specs/weapons.md`). */
const FULL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens a game with the charge full and the torpedo ready", async () => {
  await startGameFromTitle(h);
  const opened = await h.snapshot();
  // The fresh game, its charge indicator full.
  await captureStill(h, "charged");

  if (opened.screen !== "playing") {
    fail(
      "a game opened from the title by confirming PLAY, so the charge a new " +
        "game begins with can be read (specs/ui.md, specs/weapons.md)",
      `the build was on the ${opened.screen} screen`,
    );
  }

  assertEqual(
    chargeOf(opened, "a game just opened from the title"),
    FULL,
    "the torpedo charge a new game begins with (specs/weapons.md: a game " +
      "begins with the charge at 1, ready to fire)",
  );
  assertEqual(
    readyOf(opened, "a game just opened from the title"),
    true,
    "torpedoReady on a new game, which specs/instrumentation.md makes true " +
      "exactly when the charge is 1",
  );
});
