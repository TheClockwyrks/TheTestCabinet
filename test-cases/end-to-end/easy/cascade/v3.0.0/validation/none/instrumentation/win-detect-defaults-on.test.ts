// instrumentation/win-detect-defaults-on — `reset()` puts the winDetect gate
// back on.
//
// THE RULE. `specs/instrumentation.md`, The faculty gates: "each is on by default
// and restored to on by `reset`". `specs/state.md` says the same of the state
// itself: "All four are on when a game begins, and the debugging surface poses
// them." The gate this point is about is `setWinDetect`, which gates
// the check that all fifty-two cards are home and the move to the `won` screen.
//
// WHY IT IS ITS OWN POINT. Every scenario in this suite that does NOT name a gate
// rests on the four standing on: `openTable` leaves them exactly where `reset`
// put them, so a build whose winDetect started off would quietly change the meaning
// of dozens of checks that never mention it. Four gates, four defaults, four
// points, so a grade names the one a build left off rather than the group.
//
// THE GATE IS POSED OFF FIRST, so what is read afterwards is a RESTORATION rather
// than a value that was never touched: a build whose `reset` restores nothing
// reads back the `false` it was left holding. That the pose really landed is
// asserted before the reset, so a build whose gate cannot be posed at all fails
// saying so rather than passing on a value that never moved —
// `instrumentation/win-detect-gate-off` is the point that grades the pose itself.
//
// NO FRAME RUNS BETWEEN THE RESET AND THE READING, so what is read is the reset's
// own work rather than an update's.
//
// WHAT THIS DOES NOT DECIDE. What the gate GATES, which is
// `instrumentation/win-detect-gate-off` and `instrumentation/win-detect-gate-on`; and the
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

afterEach(async () => {
  await h.dispose();
});

it("reports winDetect on again after a reset that followed it going off", async () => {
  await h.debug.setWinDetect(false);
  assertEqual(
    (await h.snapshot()).winDetect,
    false,
    "posing: winDetect after setWinDetect(false) — a gate that would not go off " +
      "leaves the reset nothing to restore",
  );

  await h.debug.reset();
  // Read with no frame between, so what is read is the reset's own work.
  const title = (await h.snapshot()).winDetect;

  await h.advance(SETTLE_FRAMES);
  // Before the assertion, so a failing reset still leaves the picture of the
  // table it returned to.
  await captureStill(h, "reset");

  assertEqual(
    title,
    true,
    "winDetect after a reset that followed setWinDetect(false): each gate is " +
      "restored to on by reset (specs/instrumentation.md)",
  );
});
