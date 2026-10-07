// Wick — audio/music-through-levelup: the bed keeps looping under an open
// level-up overlay.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, The loops: "`music` is
// looping on every frame exactly when `screen` is `playing`, `levelup`,
// `chest`, or `paused`. It starts on the frame a fresh run starts and keeps
// playing through the overlays and the pause". `levelup` is one of the four
// screens the rule names, and "on every frame" is what makes the reading a
// whole span rather than one sample: the threshold is `true` on every frame
// of the overlay.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with the bed already up
// (the frame `isolatedRun` spends is the one the loops are reconciled on),
// then one level-up posed and the one `playing` tick that opens the overlay:
// "A `playing` tick that ends with `pendingLevelUps` above `0` runs to
// completion and then opens the overlay" (`specs/progression.md`). The run
// holds no weapon and no passive, so every base weapon and every passive is a
// candidate and the overlay fills its draw rather than falling back
// (`specs/progression.md`, The candidate pool).
//
// The overlay is then left standing for `FRAMES` frames with no key pressed,
// so nothing accepts an offer and the screen holds. `specs/ui.md` says
// nothing advances under it — "`levelup`, `chest`, `paused`: Nothing. The
// world beneath holds exactly the tick it was at" — so the only thing those
// frames can change is the bed, which is what is read. Every driver switch is
// off and the world holds nothing, so no ending can arrive and stop it.
//
// THE TOLERANCE. None: "on every frame" admits no gap, and the reading is a
// boolean. `FRAMES` (60, one second of frames) is a drive length rather than
// a threshold: long enough that a bed restarted per frame or stopped a beat
// after the overlay opened is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  openLevelUp,
  type Harness,
} from "../harness";
import { isolatedRun, loopTrace } from "./cues";

/** One second of frames under the overlay. */
const FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has music looping on every frame of an open level-up overlay", async () => {
  await isolatedRun(h);
  assertEqual(
    h.looping(CUES.music),
    true,
    "whether the bed was up on playing before the overlay opened",
  );

  const opened = await openLevelUp(h, 1);
  assertEqual(
    opened.screen,
    "levelup",
    "the screen the tick with a level-up queued ended on",
  );

  const trace = await captureReplay(h, "levelup", () =>
    loopTrace(h, CUES.music, FRAMES),
  );

  assertEqual(
    h.snapshot().screen,
    "levelup",
    "the screen the overlay held for the whole span",
  );
  assertEqual(
    trace.filter((looping) => !looping).length,
    0,
    `frames of the open overlay on which music was not looping, of ${FRAMES} (specs/ui.md, The loops)`,
  );
});
