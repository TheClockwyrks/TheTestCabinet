// Wick — audio/music-stops-on-dawn: the bed stops when the run ends at dawn.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, The loops: "`music` is
// looping on every frame exactly when `screen` is `playing`, `levelup`,
// `chest`, or `paused` ... and it stops on the frame the run ends, fallen or
// at dawn, or `back` on `paused` abandons it." `dawn` is not one of the four
// screens the rule names, so the threshold is `false` on every frame of it.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with the bed already up
// (the frame `isolatedRun` spends is the one the loops are reconciled on),
// read as `true` before the ending so what this point decides is the STOP
// rather than a bed that never started. Then the clock posed to `LAST_TICK`
// (`35999`) and one tick, so the tick's clock phase raises `tick` to the
// `36000` that `specs/world.md` ends the night on. `setTick` changes nothing
// else and a pose sounds nothing, so the ending is the game's own rule
// reached from a posed clock; `hp` is untouched and full, so the fallen
// ending cannot take this tick instead.
//
// Dawn is driven as well as fallen because `specs/ui.md` names the two
// endings separately and a build may have wired the stop into one path only.
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
import { CUES, DAWN_TICK } from "../constants";
import {
  captureReplay,
  createHarness,
  endDawn,
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

it("has music not looping on the frames after the run ends at dawn", async () => {
  await isolatedRun(h);
  assertEqual(
    h.looping(CUES.music),
    true,
    "whether the bed was up on playing before the run ended",
  );

  const ended = await endDawn(h);
  assertEqual(
    ended.run.tick,
    DAWN_TICK,
    "the clock the ending tick left (specs/world.md, Fallen and dawn)",
  );
  assertEqual(ended.screen, "dawn", "the screen that tick ended on");

  const trace = await captureReplay(h, "stopped", () =>
    loopTrace(h, CUES.music, FRAMES),
  );

  assertEqual(
    h.snapshot().screen,
    "dawn",
    "the screen the end held for the whole span",
  );
  assertEqual(
    trace.filter((looping) => looping).length,
    0,
    `frames of the dawn screen on which music was still looping, of ${FRAMES} (specs/ui.md, The loops)`,
  );
});
