// save/victory-consumes-the-save — winning spends the save.
//
// specs/gameplay.md: "A Hardcore death deletes the save. A victory consumes it. A
// Standard death leaves it intact." So the title reached after a launch offers no
// `CONTINUE` back into the expedition that has already been won.
//
// THE WIN IS THE GAME'S OWN. specs/rocket.md: with all five components installed
// the Launch Pad shows `LAUNCH`, and launching takes the game to the Victory
// screen. The components are posed through `setRocketInstalled`, which
// specs/instrumentation.md says costs no Credits and consumes no material, and
// the launch itself is the control that stands for the on-screen one; how long a
// build plays the lift-off out before the summary is the build's, so the screen
// is swept for rather than read on one frame.
//
// ISOLATION. One expedition on an empty mine with the slot cleared first, a save
// banked at the camp, and the miner's body and drill both gated, since neither is
// what a launch exercises.

import { afterEach, beforeEach, it } from "vitest";
import { ROCKET_COMPONENTS, TITLE_ITEMS } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drewText,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";
import {
  TITLE_ITEMS_NO_SAVE,
  bankSave,
  menuLength,
  openAtCamp,
} from "./expedition";

/** Seconds of game time the lift-off is given to reach the Victory screen. */
const LAUNCH_CEILING = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ storage: true });
});

afterEach(() => {
  h?.dispose();
});

it("leaves no save to continue once the rocket has launched", async () => {
  await openAtCamp(h);
  bankSave(h);
  pinMiner(h);
  pinDrill(h);

  h.debug.setRocketInstalled(ROCKET_COMPONENTS.length);
  h.debug.launch();

  let won = h.snapshot();
  for (
    let second = 0;
    second < LAUNCH_CEILING && won.screen !== "victory";
    second += 1
  ) {
    await h.advanceSeconds(1, 8);
    won = h.snapshot();
  }
  assertEqual(
    won.screen,
    "victory",
    "specs/rocket.md: launching takes the game to the Victory screen",
  );
  assertEqual(
    won.hasSave,
    false,
    "specs/gameplay.md: a victory consumes the save",
  );

  h.debug.setScreen("title");
  const calls = await h.frameCalls();
  captureStill(h, "spent");
  assertTrue(
    !drewText(calls, TITLE_ITEMS[0]),
    "specs/ui.md: the title after a victory carries no CONTINUE",
  );
  assertEqual(
    await menuLength(h),
    TITLE_ITEMS_NO_SAVE.length,
    "specs/ui.md: the title menu is back to two items after a victory",
  );
});
