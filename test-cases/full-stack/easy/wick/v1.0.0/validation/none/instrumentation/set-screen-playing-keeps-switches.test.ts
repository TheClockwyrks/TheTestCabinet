// Wick — instrumentation/set-screen-playing-keeps-switches: with `spawning`
// and `weaponFire` posed off, `setScreen("playing")` leaves both off.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md): "the driver
// switches all stand exactly as they were" (`setScreen`); each switch "is left
// as it stands by `setScreen`" ("The driver switches"); and specs/state.md: the
// switches are "held outside the run: a fresh run leaves them as they stand".
//
// WHY THE WORLD IS POSED AS IT IS. Two switches off and seven on, so a pose
// that restored every switch and one that cleared every switch each fail.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SWITCH_NAMES, type SwitchName } from "../constants";
import {
  captureStill,
  createHarness,
  disable,
  poseScreen,
  type Harness,
} from "../harness";

const OFF: readonly SwitchName[] = ["spawning", "weaponFire"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the driver switches as they stand across the pose", async () => {
  await disable(h, ...OFF);
  const fresh = await poseScreen(h, "playing");
  await captureStill(h, "switches");

  assertEqual(fresh.screen, "playing", "the screen after setScreen('playing')");
  for (const name of SWITCH_NAMES) {
    assertEqual(
      fresh[name],
      !OFF.includes(name),
      `the ${name} switch after the pose`,
    );
  }
});
