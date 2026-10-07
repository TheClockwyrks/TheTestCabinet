// instrumentation/set-screen-sets-the-screen — the pose reaches each of the six
// screens.
//
// specs/instrumentation.md, `setScreen(name)`: "Sets `screen` to `name`, one of
// the six values `specs/screens.md` names". Those six are the rows of
// specs/screens.md's own table, and the snapshot's `screen` field is what
// reports which one the game is on.
//
// SIX POSES, ONE REQUIREMENT: that the call reaches the screen it names. Every
// one of the six is the same requirement exercised the same way, which is what
// lets them share a validator. That the call changes NOTHING ELSE is the
// separate requirement `set-screen-leaves-the-rest` decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";
import { SIX_SCREENS } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sets the screen to each of the six the specification names", async () => {
  await h.debug.reset();
  for (const screen of SIX_SCREENS) {
    await h.debug.setScreen(screen);
    const posed = await h.snapshot();
    assertEqual(
      posed.screen,
      screen,
      `the screen after setScreen("${screen}")`,
    );
  }
  await captureStill(h, "screens");
});
