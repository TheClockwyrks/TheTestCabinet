// Wick — audio/music-through-chest: the bed keeps looping under an open chest
// overlay.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, The loops: "`music` is
// looping on every frame exactly when `screen` is `playing`, `levelup`,
// `chest`, or `paused`. It starts on the frame a fresh run starts and keeps
// playing through the overlays and the pause". `chest` is one of the four
// screens the rule names, and "on every frame" is what makes the reading a
// whole span rather than one sample: the threshold is `true` on every frame
// of the overlay.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with the bed already up
// (the frame `isolatedRun` spends is the one the loops are reconciled on),
// then one chest pickup on the lamplighter's own center and the one tick that
// collects it: a distance of `0` is inside `PICKUP_ITEM_RADIUS` (`16`) plus
// `PLAYER_RADIUS` (`12`) whatever the build's pickup radius
// (`specs/world.md`, Collection), and `specs/instrumentation.md` names this
// the real collection path. The run holds no weapon and no passive, so the
// chest heals rather than evolving or levelling, which keeps the collecting
// tick simple; the result decides nothing here.
//
// The overlay is then left standing for `FRAMES` frames with no key pressed,
// so nothing closes it. `specs/ui.md` says nothing advances under it —
// "`levelup`, `chest`, `paused`: Nothing. The world beneath holds exactly the
// tick it was at" — so the only thing those frames can change is the bed,
// which is what is read.
//
// THE TOLERANCE. None: "on every frame" admits no gap, and the reading is a
// boolean. `FRAMES` (60, one second of frames) is a drive length rather than
// a threshold.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  openChest,
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

it("has music looping on every frame of an open chest overlay", async () => {
  await isolatedRun(h);
  assertEqual(
    h.looping(CUES.music),
    true,
    "whether the bed was up on playing before the overlay opened",
  );

  const opened = await openChest(h);
  assertEqual(
    opened.screen,
    "chest",
    "the screen the collecting tick ended on (specs/progression.md)",
  );

  const trace = await captureReplay(h, "chest", () =>
    loopTrace(h, CUES.music, FRAMES),
  );

  assertEqual(
    h.snapshot().screen,
    "chest",
    "the screen the overlay held for the whole span",
  );
  assertEqual(
    trace.filter((looping) => !looping).length,
    0,
    `frames of the open overlay on which music was not looping, of ${FRAMES} (specs/ui.md, The loops)`,
  );
});
