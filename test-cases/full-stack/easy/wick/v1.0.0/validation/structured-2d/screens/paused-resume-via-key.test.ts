// Wick — screens/paused-resume-via-key: `pause` on `paused` returns to
// `playing` with the run untouched.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`paused`":
// "`pause` returns to `playing`". `specs/controls.md`, "What each screen
// reads", gives the `paused` row "`pause` resumes `playing`", with `pause`
// bound to `KeyP`. `specs/ui.md`, "What advances on each screen", holds the
// world beneath a pause "exactly the tick it was at", so the run that comes
// back is the run that was paused.
//
// WHY THE PRESS RUNS NO TICK. `specs/controls.md`: "a frame whose press enters
// `playing` ... runs that frame's ticks", so a whole-tick frame would resume
// AND advance the run, and the comparison would be reading a tick's work
// rather than the resume. The press is delivered on a frame of a single
// millisecond instead, which `specs/instrumentation.md` calls a partial frame
// and which is far short of the `TICK_DT − TICK_EPSILON` a tick is consumed
// at. What is read is therefore the run the moment the resume landed.
//
// THE DRIVE. An isolated `playing` world holding one moth, the lamplighter
// posed away from the origin and the clock posed off `0`; the pause posed
// through `setScreen("paused")` — which `specs/instrumentation.md` says enters
// it by setting `screen` alone, with the run left as it stands — and the run
// read there; then the `KeyP` this point is about.
//
// THE TOLERANCE. None: the whole run is compared field for field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  poseScreen,
  type Harness,
} from "../harness";
import { tapPartial } from "./stage";

const PLAYER_X = -80;
const PLAYER_Y = 35;
const TICK = 900;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads playing with the run the pause held", async () => {
  isolate(h);
  h.debug.setTick(TICK);
  h.debug.setPlayerPosition(PLAYER_X, PLAYER_Y);
  placeEnemy(h, "moth", PLAYER_X + 150, PLAYER_Y - 90);

  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the press is made on");

  const after = await tapPartial(h, "KeyP");
  captureStill(h, "resumed");

  assertEqual(after.screen, "playing", "the screen after KeyP on paused");
  assertDeepEqual(after.run, paused.run, "the run across the resuming frame");
});
