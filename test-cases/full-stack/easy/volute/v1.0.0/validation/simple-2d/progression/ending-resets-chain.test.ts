// progression/ending-resets-chain — a dismissed ending restores the chain
// step.
//
// THE SPEC LINE. `specs/progression.md` — "Interludes and endings":
// "dismissing it returns the game to the title screen with every value of a
// fresh run restored", and `specs/state.md` ("The title state"), whose table
// gives a row per field: "`initialize` and a `reset` build the values below,
// and leaving a run for the title restores them." This point's value is "|
// `chainStep`, `chainTimer` | `1`, `0` |".
//
// ONE VALUE, ONE POINT. `progression/ending.ts` carries the ended run every
// one of these points is read off and says why each figure is moved off its
// fresh-run value first; this file reads the chain step and nothing else.
//
// WHY IT IS A POINT. A build that keeps the ended run's step scores the next
// run's first extraction at a multiplier nothing was chained for.
//
// THE TOLERANCE. None. A chain step is a count, and the standing tolerances
// make it exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { ENDED_CHAIN_STEP, dismissEnding } from "./ending";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the chain step back to 1 when an ending is dismissed", async () => {
  const dismissal = await dismissEnding(h);
  await captureStill(h, "chain");

  assertEqual(
    dismissal.posed.chainStep,
    ENDED_CHAIN_STEP,
    "the chain step the ended run carried before the press",
  );
  assertEqual(
    dismissal.title.chainStep,
    1,
    "the chain step a dismissed ending restored",
  );
});
