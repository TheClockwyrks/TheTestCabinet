// Wick — screens/paused-confirm-resume: confirming `RESUME` returns to
// `playing` with the run untouched.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`paused`", gives
// the menu `PAUSE_ITEMS` with `RESUME` first and the item table the row
// "`RESUME` | Sets `screen = playing`, with the run untouched", and
// "`menuIndex` is `0` on arriving ... `confirm` takes the highlighted item".
// `specs/controls.md` binds `confirm` to `Enter` and `Space`, and gives the
// `paused` row "`confirm` takes the highlighted item". `specs/ui.md`, "What
// advances on each screen", holds the world beneath a pause "exactly the tick
// it was at", so the run that comes back is the run that was paused.
//
// WHY THE PRESS RUNS NO TICK. `specs/controls.md`: "a frame whose press enters
// `playing` ... runs that frame's ticks", so a whole-tick frame would resume
// AND advance the run, and the comparison would be reading a tick's work
// rather than the resume. The press is delivered on a frame of a single
// millisecond instead, which `specs/instrumentation.md` calls a partial frame
// and which is far short of the `TICK_DT − TICK_EPSILON` a tick is consumed
// at.
//
// THE DRIVE. An isolated `playing` world holding one moth and one gem, the
// lamplighter posed away from the origin and the clock posed off `0`; the
// pause posed through `setScreen("paused")` — which `specs/instrumentation.md`
// says enters it "exactly as `pause` does" — which arrives on `RESUME`, the
// item at index `0`; then the `Enter` this point is about. What the keys that
// resume without the menu do is `screens/paused-resume-via-key`'s and
// `screens/paused-back-resumes`' point.
//
// THE TOLERANCE. None: the whole run is compared field for field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  placeGem,
  poseScreen,
  type Harness,
} from "../harness";
import { tapPartial } from "./stage";

/** The index `RESUME` occupies in the pause menu (specs/ui.md, PAUSE_ITEMS). */
const RESUME_INDEX = PAUSE_ITEMS.indexOf("RESUME");

/** Where the lamplighter stands, and the clock it stands at, before the pause. */
const PLAYER_X = -120;
const PLAYER_Y = 40;
const TICK = 2100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads playing with the run the pause held after Enter on RESUME", async () => {
  isolate(h);
  h.debug.setTick(TICK);
  h.debug.setPlayerPosition(PLAYER_X, PLAYER_Y);
  placeEnemy(h, "moth", PLAYER_X + 250, PLAYER_Y);
  placeGem(h, "medium", PLAYER_X, PLAYER_Y - 250);

  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the press is made on");
  assertEqual(paused.menuIndex, RESUME_INDEX, "the item the pause highlights");

  const after = await tapPartial(h, "Enter");
  captureStill(h, "resumed");

  assertEqual(after.screen, "playing", "the screen after Enter on RESUME");
  assertDeepEqual(after.run, paused.run, "the run across the resuming frame");
});
