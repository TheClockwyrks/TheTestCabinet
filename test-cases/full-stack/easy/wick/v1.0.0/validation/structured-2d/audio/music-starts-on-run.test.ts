// Wick — audio/music-starts-on-run: a fresh run has `music` looping.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, The loops: "`music` is
// looping on every frame exactly when `screen` is `playing`, `levelup`,
// `chest`, or `paused`. It starts on the frame a fresh run starts and keeps
// playing through the overlays and the pause". The reading is
// `world.audio.looping`, which "reports whether it is", and the threshold is
// that it is `true` once a fresh run is under way.
//
// WHY THE SCREEN IS POSED RATHER THAN LIT FROM THE MENU. The rule is keyed on
// the SCREEN and not on how it was reached — "exactly when `screen` is
// `playing`, `levelup`, `chest`, or `paused`" — and
// `specs/instrumentation.md` states what that means for sound: "Both looping
// cues are reconciled from the state by the next frame, so a run posed through
// `setScreen("playing")` sounds exactly as one started from the menu one frame
// later." Posing keeps the title menu out of an audio point, so a build with a
// broken menu fails the menu points and is decided here on its audio alone.
//
// WHY THE WORLD IS POSED AS IT IS. `reset` first, so the game stands on
// `title` with no run, and the bed is read as `false` there before the run is
// begun: what this point decides is that the bed STARTS, and a bed that was
// already up says nothing about the start. Then `setScreen("playing")`, and
// one frame, which is the frame the specification reconciles the loops on.
// The run holds no enemy, projectile, zone, gem, or pickup and every driver
// switch is off, so nothing on that frame can end the run and stop the bed
// again.
//
// THE TOLERANCE. One frame, and no more: "reconciled from the state by the
// next frame" is the latitude the specification itself grants, and the
// reading is a boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";
import { loopTrace } from "./cues";

/** Frames read after the run begins: the reconciling frame and a few beyond. */
const FRAMES = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has music looping on the frame after a fresh run starts", async () => {
  h.reset();
  assertEqual(h.snapshot().screen, "title", "the screen reset restored");
  assertEqual(
    h.looping(CUES.music),
    false,
    "whether the bed was already up on the title before the run began",
  );

  isolate(h);
  const trace = await captureReplay(h, "started", () =>
    loopTrace(h, CUES.music, FRAMES),
  );

  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen the fresh run left, which is where the bed belongs",
  );
  assertEqual(
    trace.every((looping) => looping),
    true,
    `music looping on each of the ${FRAMES} frames after a fresh run started (specs/ui.md, The loops)`,
  );
});
