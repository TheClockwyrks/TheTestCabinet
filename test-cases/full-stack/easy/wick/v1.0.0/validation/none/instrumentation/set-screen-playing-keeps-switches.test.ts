// Wick — instrumentation/set-screen-playing-keeps-switches: with `spawning`
// and `weaponFire` posed off, `setScreen("playing")` begins a fresh run with
// both still off.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md): "The driver
// switches stay as they are" (`setScreen`); each switch "is left as it stands
// by `setScreen`" ("The driver switches"); and specs/state.md: the switches
// are "held outside the run: a fresh run leaves them as they stand".
//
// WHY THE WORLD IS POSED AS IT IS. Two switches off and five on, so a fresh run
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

it("leaves the driver switches as they stand across a fresh run", async () => {
  await disable(h, ...OFF);
  const fresh = await poseScreen(h, "playing");
  await captureStill(h, "switches");

  assertEqual(fresh.screen, "playing", "the screen after setScreen('playing')");
  for (const name of SWITCH_NAMES) {
    assertEqual(
      fresh[name],
      !OFF.includes(name),
      `the ${name} switch after the fresh run`,
    );
  }
});
