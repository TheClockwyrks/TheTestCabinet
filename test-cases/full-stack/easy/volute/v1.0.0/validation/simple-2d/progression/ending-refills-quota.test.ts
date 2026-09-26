// progression/ending-refills-quota — a dismissed ending restores the quota
// remaining.
//
// THE SPEC LINE. `specs/progression.md` — "Interludes and endings":
// "dismissing it returns the game to the title screen with every value of a
// fresh run restored", and `specs/state.md` ("The title state"), whose table
// gives a row per field: "`initialize` and a `reset` build the values below,
// and leaving a run for the title restores them." This point's value is "|
// `quotaRemaining` | level `1`'s `quota` |".
//
// ONE VALUE, ONE POINT. `progression/ending.ts` carries the ended run every
// one of these points is read off and says why each figure is moved off its
// fresh-run value first; this file reads the quota remaining and nothing else.
//
// WHY IT IS A POINT. The title holds no channel, so unlike a cell spend
// nothing is seeded against the quota and the whole of level 1's value is
// left: a build that carries the ended level's remainder forward runs its next
// level short.
//
// THE TOLERANCE. None. A quota is a count, and the standing tolerances make a
// count exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { levelSpec } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { ENDED_QUOTA, dismissEnding } from "./ending";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves level 1's full quota still to emit when an ending is dismissed", async () => {
  const dismissal = await dismissEnding(h);
  await captureStill(h, "quota");

  assertEqual(
    dismissal.posed.quotaRemaining,
    ENDED_QUOTA,
    "the quota the ended run had left before the press",
  );
  assertEqual(
    dismissal.title.quotaRemaining,
    levelSpec(1).quota,
    "the quota a dismissed ending restored, level 1's full value",
  );
});
