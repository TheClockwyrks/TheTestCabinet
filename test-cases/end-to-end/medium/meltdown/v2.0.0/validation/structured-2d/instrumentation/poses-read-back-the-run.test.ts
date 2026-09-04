// Meltdown — instrumentation/poses-read-back-the-run — the screen, the phase, the
// highlighted row, the mode and the difficulty read back as they were posed.
//
// WHY THIS IS A POINT. specs/instrumentation.md says the snapshot carries every
// field an operation can set, "so every operation is verifiable by setting a value
// and reading it back". That round trip is what every other group in this suite
// stands on: a check poses a heat of 60 and then asserts what one second of
// cooling did to it, and if the pose never landed the check is measuring something
// it did not arrange. A pose that silently does nothing, or that lands on a field
// the snapshot does not report, is caught here and nowhere else.
//
// ONE GROUP OF STATE, BECAUSE EACH POSE IS INDEPENDENTLY BREAKABLE. A build whose
// only broken pose is `setUnitSlow` must lose one point rather than every pose it
// got right, so the surface's poses are read as six items —
// `instrumentation.poses-read-back-the-run`, `-the-figures`, `-the-build`,
// `-a-tower`, `-a-unit` and `-the-pointer-and-the-gate` — and this one reads
// the five poses that say WHICH RUN is on screen.
//
// WHAT IS ASSERTED. That the value POSED comes back. Not what the game does with
// it afterwards, and not that a rule fired: `setLives` triggers no game over,
// `setScore` pays no bonus, `setScreen` runs no entry effect — each of those is a
// point of its own.
//
// THE READING IS TAKEN FROM THE POSE ITSELF, before any frame runs. `snapshot` is
// a pure read of the state (specs/instrumentation.md), so a pose is readable the
// moment it is made — which is what makes this a check of the OPERATION rather
// than of what a frame did to its result.
//
// EVERY POSED VALUE IS DISTINGUISHING. No two fields carry the same number and none
// of them carries a default, so a build that reports one field where another was
// posed, or that reports a constant, reads as the wrong number rather than
// coincidentally right.
//
// THE SCREEN IS NOT `title`, THE MODE IS NOT `containment` AND THE DIFFICULTY IS
// NOT `medium`, because those three are what `reset` restores: a build whose pose
// does nothing at all would read them back correctly if the posed value were the
// default.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The row the highlight is posed on: no `reset` restores it. */
const MENU_INDEX = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the screen, the phase, the row, the mode and the difficulty as posed", async () => {
  startRun(h);

  h.debug.setScreen("howto");
  assertEqual(h.snapshot().screen, "howto", "setScreen");
  h.debug.setPhase("wave");
  assertEqual(h.snapshot().phase, "wave", "setPhase");
  h.debug.setMenuIndex(MENU_INDEX);
  assertEqual(h.snapshot().menuIndex, MENU_INDEX, "setMenuIndex");
  h.debug.setMode("bottleneck");
  assertEqual(h.snapshot().mode, "bottleneck", "setMode");
  h.debug.setDifficulty("hard");
  assertEqual(h.snapshot().difficulty, "hard", "setDifficulty");

  // The evidence: the run the five poses arranged. The screen goes back to
  // `playing` first, because the run's own screen was posed to `howto` up there
  // and a picture of the how-to page shows a reviewer nothing.
  h.debug.setScreen("playing");
  await h.advance(1);
  captureStill(h, "posed");
});
