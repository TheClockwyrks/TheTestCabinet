// progression/ending-resets-aim — a dismissed ending restores the injector's
// aim.
//
// THE SPEC LINE. `specs/progression.md` — "Interludes and endings":
// "dismissing it returns the game to the title screen with every value of a
// fresh run restored", and `specs/state.md`: "On `title` the run's values are
// score `0`, level `1`, `CELLS` cells, level 1's full quota still to emit,
// pressure `0`, chain step `1`, no machinery, an empty channel, no
// projectiles, an aim of `270` degrees, and every timer at `0`." This point's
// value is "an aim of `270` degrees".
//
// ONE VALUE, ONE POINT. `progression/ending.ts` carries the ended run every
// one of these points is read off and says why each figure is moved off its
// fresh-run value first; this file reads the injector's aim and nothing else.
//
// WHY IT IS A POINT. The aim is the one injector figure a run carries across a
// level, so a build that never restores it opens the next run with the barrel
// where the last one left it.
//
// THE TOLERANCE. The case's standing angle tolerance of +/- 1 degree, since an
// aim is a real number a build may hold to its own precision.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear } from "../assert";
import { ANGLE_TOL, OPENING_AIM } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { ENDED_AIM, dismissEnding } from "./ending";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the aim to 270 degrees when an ending is dismissed", async () => {
  const dismissal = await dismissEnding(h);
  captureStill(h, "aim");

  assertAngleNear(
    dismissal.posed.injector.aim,
    ENDED_AIM,
    ANGLE_TOL,
    "the aim the ended run carried before the press",
  );
  assertAngleNear(
    dismissal.title.injector.aim,
    OPENING_AIM,
    ANGLE_TOL,
    "the aim a dismissed ending restored",
  );
});
