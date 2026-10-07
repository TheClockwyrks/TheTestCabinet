// progression/ending-clears-channel — a dismissed ending restores the channel.
//
// THE SPEC LINE. `specs/progression.md` — "Interludes and endings":
// "dismissing it returns the game to the title screen with every value of a
// fresh run restored", and `specs/state.md`: "On `title` the run's values are
// score `0`, level `1`, `CELLS` cells, level 1's full quota still to emit,
// pressure `0`, chain step `1`, no machinery, an empty channel, no
// projectiles, an aim of `270` degrees, and every timer at `0`." This point's
// value is "an empty channel".
//
// ONE VALUE, ONE POINT. `progression/ending.ts` carries the ended run every
// one of these points is read off and says why each figure is moved off its
// fresh-run value first; this file reads the channel and nothing else.
//
// WHY IT IS A POINT. A build that leaves the ended run's cores standing opens
// its next run on a channel that already carries a train, on top of the twelve
// a level seeds. What a dismissal does to the shots in flight is
// `progression/ending-discards-projectiles`' point.
//
// THE TOLERANCE. None. A count of cores is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  coreCount,
  createHarness,
  type Harness,
} from "../harness";
import { ENDED_CORE_COUNT, dismissEnding } from "./ending";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the channel when an ending is dismissed", async () => {
  const dismissal = await dismissEnding(h);
  captureStill(h, "cleared");

  assertEqual(
    coreCount(dismissal.posed),
    ENDED_CORE_COUNT,
    "the cores standing on the ended run's channel before the press",
  );
  assertEqual(
    coreCount(dismissal.title),
    0,
    "the cores a dismissed ending left standing",
  );
});
