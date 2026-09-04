// progression/ending-resets-level — a dismissed ending restores the level.
//
// THE SPEC LINE. `specs/progression.md` — "Interludes and endings":
// "dismissing it returns the game to the title screen with every value of a
// fresh run restored", and `specs/state.md` ("The title state"), whose table
// gives a row per field: "`initialize` and a `reset` build the values below,
// and leaving a run for the title restores them." This point's value is "|
// `score`, `level`, `cells` | `0`, `1`, `CELLS` |".
//
// ONE VALUE, ONE POINT. `progression/ending.ts` carries the ended run every
// one of these points is read off and says why each figure is moved off its
// fresh-run value first; this file reads the level and nothing else.
//
// WHY IT IS A POINT. A build that keeps the ended run's level starts its next
// run at a quota and a feed speed the player never earned.
//
// THE TOLERANCE. None. A level is a count, and the standing tolerances make a
// count exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { ENDED_LEVEL, dismissEnding } from "./ending";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the level back to 1 when an ending is dismissed", async () => {
  const dismissal = await dismissEnding(h);
  await captureStill(h, "level");

  assertEqual(
    dismissal.posed.level,
    ENDED_LEVEL,
    "the level the ended run stood on before the press",
  );
  assertEqual(
    dismissal.title.level,
    1,
    "the level a dismissed ending restored",
  );
});
