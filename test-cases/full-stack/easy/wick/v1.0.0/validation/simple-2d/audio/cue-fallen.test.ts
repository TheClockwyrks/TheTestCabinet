// Wick — audio/cue-fallen: the tick that ends the run with `hp` at or below
// `0` plays `fallen`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`fallen` | `CUES.fallen` | The run ends fallen",
//     and "Each is played on the tick its event happens".
//   - specs/world.md (Fallen and dawn): "A run ends at the end of a tick,
//     after every other phase of that tick has been applied", with the row
//     "Fallen | `hp` is `0` or below. | `fallen`".
//   - specs/instrumentation.md (`setHp`): "A value at or below `0` ends the
//     run fallen at the end of the next `playing` tick, through the ending
//     rule of `specs/world.md`"; a pose "sounds nothing", so the ending is the
//     tick's doing and not the pose's.
//
// WHAT IS READ. Exactly one `fallen` play across the one ending tick, with
// `screen` on `fallen` as the evidence that the run really ended that way.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field,
// no weapon held, and every driver switch off, so the ending is reached without
// an enemy touching the lamplighter and no hit, kill, or contact cue lands on
// the tick beside it. `hp` is posed to `0` rather than driven down by contact,
// because the requirement is about the cue on the ending and not about how the
// health was lost.
//
// TOLERANCE. None. The reading is a count and the screen is discrete.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  onCue,
  type Harness,
} from "../harness";
import { assertPlayed } from "./cues";

/** The health posed: the boundary the ending rule names, "`0` or below". */
const FALLEN_HP = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays fallen once on the tick the run ends fallen", async () => {
  isolate(h);
  h.debug.setHp(FALLEN_HP);
  const cues = onCue(h);

  const after = await captureReplay(h, "fallen", () => h.tick(1));

  assertEqual(after.screen, "fallen", "the screen after the ending tick");
  assertPlayed(cues, "fallen", 1, "fallen cues on the ending tick");
});
