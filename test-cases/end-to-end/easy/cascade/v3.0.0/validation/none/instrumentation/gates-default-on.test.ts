// instrumentation/gates-default-on — every one of the four faculty gates is on
// after `reset()`.
//
// THE RULE. `specs/instrumentation.md`, The faculty gates: "each is on by default
// and restored to on by `reset`". `specs/state.md` says the same of the state
// itself: "All four are on when a game begins, and the debugging surface poses
// them."
//
// WHY IT IS ITS OWN POINT. Every scenario in this suite that does NOT name a gate
// rests on the four standing on: `openTable` leaves them exactly where `reset`
// put them, so a build whose launching or whose automatic flip started off would
// quietly change the meaning of dozens of checks that never mention it. A grade
// that names the default here is worth more than four grades that name a mechanic.
//
// ALL FOUR ARE POSED OFF FIRST, so this is a reading of a restoration rather than
// of a game that had never touched them: a build whose `reset` restores nothing
// reads back the `false` it was left holding, and the failure names which gate.
//
// WHAT THIS DOES NOT DECIDE. What any gate GATES. Each of the four has its own
// point in this group — `auto-flip-gate`, `win-detect-gate`, `launching-gate` and
// `trail-painting-gate` — and a build whose gate reads back correctly while
// gating nothing fails there and not here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The four gates, under the names `specs/instrumentation.md` gives them. */
const GATES = [
  { pose: "setAutoFlip", field: "autoFlip" },
  { pose: "setWinDetect", field: "winDetect" },
  { pose: "setLaunching", field: "launching" },
  { pose: "setTrailPainting", field: "trailPainting" },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns all four faculty gates back on", async () => {
  // Every gate away from the value the reset is about to restore.
  for (const gate of GATES) await h.debug[gate.pose](false);

  const held = await h.snapshot();
  for (const gate of GATES) {
    assertEqual(
      held[gate.field],
      false,
      `snapshot().${gate.field} after ${gate.pose}(false), before the reset — ` +
        `a gate that would not go off leaves nothing here to restore`,
    );
  }

  await h.debug.reset();
  // Read with no frame between, so what is read is the reset's own work.
  const title = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing reset still leaves the picture of the
  // table it returned to.
  await captureStill(h, "reset");

  for (const gate of GATES) {
    assertEqual(
      title[gate.field],
      true,
      `snapshot().${gate.field} after reset(), which restores every faculty ` +
        `gate to on (specs/instrumentation.md)`,
    );
  }
});
