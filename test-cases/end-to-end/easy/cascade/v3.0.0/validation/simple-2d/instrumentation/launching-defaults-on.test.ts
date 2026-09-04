// instrumentation/launching-defaults-on — `reset()` puts the launching gate
// back on.
//
// THE RULE. `specs/instrumentation.md`, The faculty gates: "each is on by default
// and restored to on by `reset`". `specs/state.md` says the same of the state
// itself: "All four are on when a game begins, and the debugging surface poses
// them." The gate this point is about is `setLaunching`, which gates
// the cascade's launch clock and the launching of the next card.
//
// WHY IT IS ITS OWN POINT. Every scenario in this suite that does NOT name a gate
// rests on the four standing on: `openTable` leaves them exactly where `reset`
// put them, so a build whose launching started off would quietly change the meaning
// of dozens of checks that never mention it. Four gates, four defaults, four
// points, so a grade names the one a build left off rather than the group.
//
// THE GATE IS POSED OFF FIRST, so what is read afterwards is a RESTORATION rather
// than a value that was never touched: a build whose `reset` restores nothing
// reads back the `false` it was left holding. That the pose really landed is
// asserted before the reset, so a build whose gate cannot be posed at all fails
// saying so rather than passing on a value that never moved —
// `instrumentation/launching-gate-off` is the point that grades the pose itself.
//
// NO FRAME RUNS BETWEEN THE RESET AND THE READING, so what is read is the reset's
// own work rather than an update's.
//
// WHAT THIS DOES NOT DECIDE. What the gate GATES, which is
// `instrumentation/launching-gate-off` and `instrumentation/launching-gate-on`; and the
// rest of what `reset` restores, which is
// `instrumentation/reset-restores-title`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** One frame, so a still carries the table the reading was taken from. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports launching on again after a reset that followed it going off", async () => {
  h.debug.setLaunching(false);
  assertEqual(
    h.snapshot().launching,
    false,
    "posing: launching after setLaunching(false) — a gate that would not go off " +
      "leaves the reset nothing to restore",
  );

  h.debug.reset();
  // Read with no frame between, so what is read is the reset's own work.
  const title = h.snapshot().launching;

  await h.advance(SETTLE_FRAMES);
  // Before the assertion, so a failing reset still leaves the picture of the
  // table it returned to.
  captureStill(h, "reset");

  assertEqual(
    title,
    true,
    "launching after a reset that followed setLaunching(false): each gate is " +
      "restored to on by reset (specs/instrumentation.md)",
  );
});
