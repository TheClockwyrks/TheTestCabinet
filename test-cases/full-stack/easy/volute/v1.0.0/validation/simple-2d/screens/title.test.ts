// screens/title — a fresh hall opens on the title screen.
//
// WHAT THIS DECIDES. One thing: the screen a fresh game reports is `title`.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("Screens"): the seven screens, of which `title` is "The front
//   door", and under its own heading, "The game opens here."
//   specs/state.md ("The title state"): on a fresh game `screen` is `title`.
//   specs/instrumentation.md (`reset`): a reset "Restores every declared field
//   of the game's state to its title-screen value: the `title` screen, the
//   score `0`, the level `1` ...".
//
// THE DRIVE, AND WHY IT IS TWO READINGS. "The game opens here" is a fact about
// what a fresh game OPENS on, and `reset` is a separate promise that it goes back
// there. So `createHarness` reads the screen the build stood the hall up on
// BEFORE it touches anything — the page loaded, the surface installed, no reset
// called and no tick stepped — and then takes the game off the wall clock and
// calls `reset()`, which is the drive the item names. Both readings are asserted:
// without the first, a build whose fresh page opened straight into a live hall
// would pass on the reset alone. One tick is stepped before the still is taken so
// the picture the reviewer sees is a frame the build actually drew; a tick on
// `title` advances nothing (specs/ui.md, "What advances on each screen"), so it
// cannot change either reading.
//
// THE TOLERANCE. None: a screen name is compared exactly (test-case.toml,
// STANDING TOLERANCES — "count, score, charge id, screen | exact"). Nothing
// about the title's LOOK is asserted, because specs/ui.md "fixes no palette, no
// font, no layout, and no styling for any screen"; what the title puts on the
// field is the reviewer's, and the still is the evidence they read it from.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the title screen on a fresh hall", async () => {
  await h.step(1); // paint the title, so the still is a frame the build drew
  await captureStill(h, "title");

  assertEqual(
    h.openingScreen,
    "title",
    "the screen the build stood a fresh hall up on, before anything reset it",
  );
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen a fresh hall opens on",
  );
});
