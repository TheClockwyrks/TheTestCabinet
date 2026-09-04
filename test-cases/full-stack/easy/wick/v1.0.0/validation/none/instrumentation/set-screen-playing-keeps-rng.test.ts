// Wick — instrumentation/set-screen-playing-keeps-rng: `rngState` holds the
// same value after `setScreen("playing")` as before it.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// "Nothing else changes: the run, the loadout, `offers`, `nextOffers`,
// `chestResult`, `pendingLevelUps`, `rngState`, `simTime`, and the driver
// switches all stand exactly as they were." `simTime` across the same call is
// `instrumentation/set-screen-playing-keeps-sim-time`'s.
//
// WHY THE WORLD IS POSED AS IT IS. The generator is seeded with a seed of this
// check's own, then the pose is made from the title and again from an end
// screen, and the figure is read exactly across each call. A build that
// reseeded or drew on this pose changes it. Each call is bracketed inside the
// page, because the same document leaves the build's own loop running in real
// time while the clock is held, so a reading taken across two crossings would
// count whatever those frames drew.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  bracket,
  captureStill,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";

const SEED = 5150;
const TITLE_FRAMES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves rngState as it is across the pose", async () => {
  await h.debug.reset({ seed: SEED });
  await h.step(TITLE_FRAMES);

  const first = await bracket(h, "setScreen", ["playing"]);
  assertEqual(
    first.before.screen,
    "title",
    "the screen the first call is made on",
  );
  assertEqual(
    first.after.screen,
    "playing",
    "the screen after setScreen('playing')",
  );
  assertEqual(
    first.after.rngState,
    first.before.rngState,
    "rngState across the pose from title",
  );

  await h.step(TITLE_FRAMES);
  await poseScreen(h, "fallen");
  const second = await bracket(h, "setScreen", ["playing"]);
  await captureStill(h, "kept");
  assertEqual(
    second.before.screen,
    "fallen",
    "the screen the second call is made on",
  );
  assertEqual(
    second.after.rngState,
    second.before.rngState,
    "rngState across the pose from fallen",
  );
});
