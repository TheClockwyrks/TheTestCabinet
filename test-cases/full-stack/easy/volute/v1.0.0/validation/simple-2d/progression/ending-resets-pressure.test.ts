// progression/ending-resets-pressure — a dismissed ending restores the
// pressure.
//
// THE SPEC LINE. `specs/progression.md` — "Interludes and endings":
// "dismissing it returns the game to the title screen with every value of a
// fresh run restored", and `specs/state.md` ("The title state"), whose table
// gives a row per field: "`initialize` and a `reset` build the values below,
// and leaving a run for the title restores them." This point's value is "|
// `pressure` | `0` |".
//
// ONE VALUE, ONE POINT. `progression/ending.ts` carries the ended run every
// one of these points is read off and says why each figure is moved off its
// fresh-run value first; this file reads the pressure and nothing else.
//
// WHY IT IS A POINT. A build that carries the ended run's pressure forward
// opens its next level with the train already riding fast.
//
// THE TOLERANCE. The case's standing pressure tolerance of +/- 0.05, since the
// pressure is a real number a build may hold to its own precision.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { PRESSURE_MIN, PRESSURE_TOL } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { ENDED_PRESSURE, dismissEnding } from "./ending";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the pressure back to 0 when an ending is dismissed", async () => {
  const dismissal = await dismissEnding(h);
  await captureStill(h, "pressure");

  assertNear(
    dismissal.posed.pressure,
    ENDED_PRESSURE,
    PRESSURE_TOL,
    "the pressure the ended run carried before the press",
  );
  assertNear(
    dismissal.title.pressure,
    PRESSURE_MIN,
    PRESSURE_TOL,
    "the pressure a dismissed ending restored",
  );
});
