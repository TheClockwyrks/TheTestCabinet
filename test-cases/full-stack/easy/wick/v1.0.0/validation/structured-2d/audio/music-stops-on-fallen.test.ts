// Wick — audio/music-stops-on-fallen: the bed stops when the run ends fallen.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, The loops: "`music` is
// looping on every frame exactly when `screen` is `playing`, `levelup`,
// `chest`, or `paused` ... and it stops on the frame the run ends, fallen or
// at dawn, or `MAIN MENU` on `paused` abandons it." `fallen` is not one of
// the four screens the rule names, so the threshold is `false` on every frame
// of it.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with the bed already up
// (the frame `isolatedRun` spends is the one the loops are reconciled on),
// read as `true` before the ending so what this point decides is the STOP
// rather than a bed that never started. Then `hp` posed to `0` and one tick:
// "A value at or below `0` ends the run fallen at the end of the next
// `playing` tick, through the ending rule of `specs/world.md`"
// (`specs/instrumentation.md`), so the ending is the game's own rule reached
// from a posed field. The clock is nowhere near dawn, so the dawn ending,
// which "is checked first", cannot take this tick instead.
//
// The end screen is then held for `FRAMES` frames with no key pressed, so
// nothing starts another run. `specs/instrumentation.md` reconciles the loops
// "by the next frame", which is the latitude the reading below grants: the
// trace starts at the frame after the ending tick.
//
// THE TOLERANCE. One frame for the reconciliation, which the specification
// itself grants, and no gap after it. The reading is a boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  endFallen,
  type Harness,
} from "../harness";
import { isolatedRun, loopTrace } from "./cues";

/** Frames read after the ending tick: the reconciling frame and a second of them. */
const FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has music not looping on the frames after the run ends fallen", async () => {
  await isolatedRun(h);
  assertEqual(
    h.looping(CUES.music),
    true,
    "whether the bed was up on playing before the run ended",
  );

  const ended = await endFallen(h);
  assertEqual(
    ended.screen,
    "fallen",
    "the screen the tick with hp at zero ended on (specs/world.md)",
  );

  const trace = await captureReplay(h, "stopped", () =>
    loopTrace(h, CUES.music, FRAMES),
  );

  assertEqual(
    h.snapshot().screen,
    "fallen",
    "the screen the end held for the whole span",
  );
  assertEqual(
    trace.filter((looping) => looping).length,
    0,
    `frames of the fallen screen on which music was still looping, of ${FRAMES} (specs/ui.md, The loops)`,
  );
});
