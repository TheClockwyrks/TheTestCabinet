// Wick — instrumentation/set-screen-playing-keeps-sim-time: `simTime` holds the
// same value after `setScreen("playing")` as before it.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// "Nothing else changes: the run, the loadout, `offers`, `nextOffers`,
// `chestResult`, `pendingLevelUps`, every posed outcome, `simTime`, and the
// driver switches all stand exactly as they were."
//
// WHY THE WORLD IS POSED AS IT IS. A few title frames are run first so
// `simTime` is not `0` and a build that restarted its clock on this pose is
// told from one that left it alone; then the pose is made from the title and
// again from an end screen. Each call is bracketed inside the page, because the
// same document leaves the build's own loop running in real time while the
// clock is held and has `simTime` rise by the delta of every frame it runs, so
// a reading taken across two crossings would count those frames too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import {
  bracket,
  captureStill,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";

const TITLE_FRAMES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves simTime as it is across the pose", async () => {
  await h.debug.reset();
  const before = await h.step(TITLE_FRAMES);
  assertNotEqual(before.simTime, 0, "simTime before the pose");

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
    first.after.simTime,
    first.before.simTime,
    "simTime across the pose from title",
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
    second.after.simTime,
    second.before.simTime,
    "simTime across the pose from fallen",
  );
});
