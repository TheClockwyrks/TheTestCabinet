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
// THIS IS ONE OF THE TWO POINTS THAT BUILD THEIR OWN CLOCK. The harness runs at a
// frame rate whose frames are a whole eighth of a tick, which is what every other
// point wants and exactly what this one cannot use: the claim is about a frame
// that is not a whole tick, so the frame has to be chosen. Half a tick is
// `0.0625` s, a binary fraction a double holds exactly, so two frames of it sum
// to exactly `TICK_SECONDS` and the tick the second one lands is decided by the
// build's rule rather than by rounding.

import { afterEach, beforeEach, it } from "vitest";
import { ConstantClock } from "@test-cabinet/simple-2d";
import { assertDeepEqual, assertEqual } from "../assert";
import { TICK_SECONDS } from "../../src/constants";
import {
  ahead,
  arrangeStep,
  captureReplay,
  createHarness,
  type Cell,
  type Harness,
} from "../harness";

/** Where the chain is posed, with a clear cell ahead of it for the tick to enter. */
const HEAD: Cell = { col: 10, row: 8 };

/** Half a tick of game time, which is what one frame of this check is worth. */
const HALF_MS = (TICK_SECONDS / 2) * 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new ConstantClock(HALF_MS) });
});

afterEach(() => {
  h?.dispose();
});

it("resolves no tick under TICK_SECONDS, then lands one when the time is made up", async () => {
  const posed = arrangeStep(h, { head: HEAD, dir: "right", length: 3 });
  assertEqual(posed.snapshot.ticks, 0, "ticks before the first update");

  const carried = await captureReplay(h, "carried", async () => {
    await h.advance(1);
    const short = h.snapshot();
    await h.advance(1);
    return { short, made: h.snapshot() };
  });

  // Half a tick resolved nothing, and nothing moved.
  assertEqual(carried.short.ticks, 0, "ticks after half a tick of game time");
  assertDeepEqual(
    carried.short.snake,
    posed.snapshot.snake,
    "the chain after it",
  );

  // The remainder carried, so the second half made the tick up rather than being
  // measured from zero again.
  assertEqual(
    carried.made.ticks,
    1,
    "ticks once the accumulator reached TICK_SECONDS",
  );
  assertDeepEqual(
    carried.made.snake[0],
    ahead(HEAD, "right"),
    "the head once the tick landed",
  );
});
