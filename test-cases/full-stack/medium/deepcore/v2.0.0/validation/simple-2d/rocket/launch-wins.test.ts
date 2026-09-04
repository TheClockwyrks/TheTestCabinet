// Deepcore — rocket/launch-wins: launching a finished rocket wins the game.
//
// `specs/rocket.md`: "Launching plays the rocket lifting off the pad ... and
// takes the game to the Victory screen ... Launching is the only way to win.
// There is no other ending." `specs/ui.md` gives the `victory` screen "The
// expedition summary, after the rocket launches."
//
// All five components are posed installed and the pad's own `LAUNCH` is called;
// the game is then run on until it reaches `victory`, since the specification
// puts the lift-off between the press and the screen without fixing how long it
// takes. The recording covers the whole of it, which is what the review item's
// output is for.
//
// The summary is read at the end, because the Victory screen is the summary:
// `specs/gameplay.md` says it reports the mode and the number of components
// installed, and `specs/modes.md` reserves a death cause for a death — so a
// victory carries none.

import { afterEach, beforeEach, it } from "vitest";
import { ROCKET_COMPONENT_IDS } from "../../src/constants";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import { openPadScene, runUntilScreenLeaves } from "./pad-scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lifts the rocket off the pad and reaches the victory screen", async () => {
  openPadScene(h);
  h.debug.setRocketInstalled(ROCKET_COMPONENT_IDS.length);

  const before = h.snapshot();
  assertNull(before.rocket.nextComponent, "a component still to build");
  assertEqual(before.screen, "in-mine", "the screen the launch is called from");

  const won = await captureReplay(h, "liftoff", async () => {
    h.debug.launch();
    return runUntilScreenLeaves(h, "in-mine");
  });

  assertEqual(won.screen, "victory", "the screen a launch takes the game to");
  assertNotNull(won.summary, "an expedition summary on the victory screen");
  assertEqual(
    won.summary?.componentsInstalled,
    ROCKET_COMPONENT_IDS.length,
    "components the summary counts",
  );
  assertNull(won.summary?.deathCause, "a death cause on a victory");
});
