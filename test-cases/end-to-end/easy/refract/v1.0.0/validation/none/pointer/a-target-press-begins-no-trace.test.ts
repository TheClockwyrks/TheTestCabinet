// Refract — pointer/a-target-press-begins-no-trace: a press inside a playing
// target begins no trace.
//
// specs/controls.md: on `playing` a press inside the `clear` or `back` target is
// taken by that target, whatever lies behind it, so the two are resolved before
// the board is. A build that runs its node targeting first would begin a trace
// under its own control, which reads to a player as a control that sometimes
// draws a beam instead of working.

import { afterEach, beforeEach, it } from "vitest";
import { R9_UNIQUE } from "../fixtures";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  targetById,
  targetCenter,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves no trace live after a press on the clear control", async () => {
  await h.debug.reset({ seed: 1 });
  await h.advance(1);
  await loadBoard(h, R9_UNIQUE);
  assertEqual(
    (await h.snapshot()).tracing,
    null,
    "no trace is live on the posed board",
  );

  const clear = targetCenter(targetById(await h.snapshot(), "clear"));
  await h.debug.pointerDown(clear.x, clear.y);
  await h.advance(1);

  assertEqual(
    (await h.snapshot()).tracing,
    null,
    "a press inside a playing target begins no trace " +
      "(specs/controls.md, Beginning a trace)",
  );
  await captureStill(h, "playing");
});
