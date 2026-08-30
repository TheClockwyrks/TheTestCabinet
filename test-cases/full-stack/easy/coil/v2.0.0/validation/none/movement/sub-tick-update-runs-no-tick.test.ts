// movement/sub-tick-update-runs-no-tick — an update shorter than a tick resolves
// none, and its time carries.
//
// specs/movement.md: the game "runs one tick for each whole `TICK_SECONDS` the
// accumulator holds, leaving the remainder to carry into the next update". Two
// halves follow from one sentence, and both are read here because a build can
// fail either separately: an update of less than a tick must resolve nothing, and
// the time it carried must still be there when the accumulator next reaches
// `TICK_SECONDS`. A build that resolves a tick per update fails the first; a
// build that throws the remainder away fails the second, and runs slow forever.
//
// THE TWO HALVES ARE EXACTLY HALF A TICK EACH. `TICK_SECONDS / 2` is `0.0625`, a
// binary fraction a double holds exactly, so two of them sum to exactly
// `TICK_SECONDS` and the tick the second one lands is decided by the rule rather
// than by rounding.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { TICK_SECONDS, type Cell } from "../constants";
import {
  ahead,
  arrangeStep,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";
import { deliver } from "./updates";

/** Where the chain is posed, with a clear cell ahead of it for the tick to enter. */
const HEAD: Cell = { col: 10, row: 8 };

/** Half a tick of game time, handed over as one update. */
const HALF = TICK_SECONDS / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resolves no tick under TICK_SECONDS, then lands one when the time is made up", async () => {
  const posed = await arrangeStep(h, { head: HEAD, dir: "right", length: 3 });
  assertEqual(posed.snapshot.ticks, 0, "ticks before the first update");

  const carried = await captureReplay(h, "carried", async () => {
    await deliver(h, HALF, 1);
    const short = await h.snapshot();
    await deliver(h, HALF, 1);
    return { short, made: await h.snapshot() };
  });

  // Half a tick resolved nothing, and nothing moved.
  assertEqual(carried.short.ticks, 0, "ticks after half a tick of game time");
  assertDeepEqual(carried.short.snake, posed.snapshot.snake, "the chain after it");

  // The remainder carried, so the second half made the tick up rather than being
  // measured from zero again.
  assertEqual(carried.made.ticks, 1, "ticks once the accumulator reached TICK_SECONDS");
  assertDeepEqual(
    carried.made.snake[0],
    ahead(HEAD, "right"),
    "the head once the tick landed",
  );
});
