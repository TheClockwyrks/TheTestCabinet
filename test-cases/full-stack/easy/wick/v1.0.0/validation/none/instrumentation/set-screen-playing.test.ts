// Wick — instrumentation/set-screen-playing: `setScreen("playing")` from
// `title`, `howto`, `fallen`, or `dawn` stands the game on `playing` with
// `menuIndex` `0`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// "Sets `screen` to `name`, one of the `Screen` values, with `menuIndex`,
// `almanacTab`, and `almanacScroll` all `0`", and "Applies on every screen".
// The pose begins no run: "a run is never begun, discarded, ended, or grown by
// it", and what a fresh run is instead is `screens/fresh-run-state`, over the
// real `LIGHT THE LAMP`.
//
// WHY THE WORLD IS POSED AS IT IS. Four screens, because `playing` is the one
// screen a build is most likely to have reached through a transition of its
// own: the two menus the reset and its own pose leave, and the two end screens
// a run ends on. The end screens are reached the real way, `hp` at `0` and the
// clock at its last tick, so the game stands where a finished run leaves it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MAX_POSED_TICK } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  poseScreen,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** `setScreen("playing")` from the screen the game stands on, read back. */
async function requirePlaying(from: string): Promise<void> {
  const playing = await poseScreen(h, "playing");
  assertEqual(
    playing.screen,
    "playing",
    `the screen after setScreen('playing') from ${from}`,
  );
  assertEqual(
    playing.menuIndex,
    0,
    `menuIndex after setScreen('playing') from ${from}`,
  );
}

it("stands the game on playing from title, howto, fallen, and dawn", async () => {
  await h.debug.reset();
  await requirePlaying("title");

  await h.debug.reset();
  await poseScreen(h, "howto");
  await requirePlaying("howto");

  await isolate(h);
  await h.debug.setHp(0);
  const fallen = await h.step(1);
  assertEqual(fallen.screen, "fallen", "the screen the ending tick left");
  await requirePlaying("fallen");

  await isolate(h);
  await h.debug.setTick(MAX_POSED_TICK);
  const dawn = await h.step(1);
  assertEqual(dawn.screen, "dawn", "the screen the tick at dawn left");
  await requirePlaying("dawn");
  await captureStill(h, "playing");
});
