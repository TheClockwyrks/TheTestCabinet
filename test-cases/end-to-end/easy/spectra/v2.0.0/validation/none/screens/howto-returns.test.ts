// Spectra — screens/howto-returns: the back action leaves how to play.
//
// THE RULE. `specs/ui.md`, on the `howto` screen: "`back` returns to `title`."
// `specs/controls.md` lists `back` among the two actions that screen reads, and
// binds it to `Escape`. This point decides that route and nothing else.
//
// THE SCREEN IS REACHED DIRECTLY. `setScreen` puts the game on `howto` without
// confirming anything on the title menu, so this point is decided on the way OUT
// alone: a build whose confirm never opened the screen loses
// `screens/howto-reachable` and still gets a fair reading here.
//
// EVERY WRONG MODEL READS AS A DIFFERENT SCREEN. A `back` wired to nothing leaves
// the game on `howto`; a `back` that quits to a run opens `stageIntro` or
// `inWave`; only the route `specs/ui.md` states lands on `title`.
//
// THE KEY IS A REAL ONE. `tap` presses it down, runs exactly one frame with it
// held, and releases it through Chromium's own input pipeline, so what reaches the
// build is a browser-trusted DOM key event on the real page.
//
// WHAT IS NOT ASSERTED. That `Escape` is `back`'s binding is
// `controls/back-escape`'s. Where the title's highlight rests on arriving back is
// `specs/ui.md`'s "with the title's highlight on `HOW TO PLAY`", which
// `screens/howto-returns-selection` reads; this point reads the screen the press
// arrived at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key `specs/controls.md` binds `back` to. It is its only binding. */
const BACK_KEY = BINDINGS.back[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title screen when back is pressed on how to play", async () => {
  await h.debug.setScreen("howto");
  await h.advance(1);
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the game is on the how-to-play screen before the press",
  );

  await h.tap(BACK_KEY);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "back on the how-to-play screen returning the game to the title " +
      "(specs/ui.md)",
  );
});
