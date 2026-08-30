// instrumentation/gates-default-on — `reset` turns all four faculties back on.
//
// THE RULE. specs/instrumentation.md, under The faculty gates: "each is on by
// default and restored to on by `reset`", and the `reset` list says the same in
// as many words — it "turns `autoFlip`, `winDetect`, `launching`, and
// `trailPainting` back on". specs/state.md carries it too: all four are on when
// a game begins.
//
// WHY IT MATTERS ON ITS OWN. Every suite opens by resetting, and a check that
// says nothing about a gate is relying on that reset to have left the faculty
// running: a build whose `reset` left `winDetect` off would win no game under
// any check in the `winning` group, and a build whose reset left `autoFlip` off
// would turn no exposed card in the `tableau` group. The gates are the one part
// of the reset list whose failure would be read as a fault in a rule rather
// than in the reset.
//
// ALL FOUR ARE TURNED OFF FIRST, so the reading is a restoration rather than a
// default that was never disturbed, and all four are read as one tuple, so a
// build that restores three of them names the fourth.
//
// THE READING IS TAKEN WITH NO FRAME ADVANCED. Under this engine a pose acts on
// the live game at the call, so the gates are back the moment `reset` returns.
//
// WHAT IT DOES NOT DECIDE. What each gate GATES is
// `instrumentation/auto-flip-gate`, `win-detect-gate`, `launching-gate` and
// `trail-painting-gate`; the rest of the reset list is
// `instrumentation/reset-restores-title`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** Every gate on: what the specification says `reset` restores. */
const ALL_ON = {
  autoFlip: true,
  winDetect: true,
  launching: true,
  trailPainting: true,
} as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every gate on after a reset that followed all four being turned off", async () => {
  h.debug.setAutoFlip(false);
  h.debug.setWinDetect(false);
  h.debug.setLaunching(false);
  h.debug.setTrailPainting(false);

  h.debug.reset();
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "reset");

  assertDeepEqual(
    {
      autoFlip: after.autoFlip,
      winDetect: after.winDetect,
      launching: after.launching,
      trailPainting: after.trailPainting,
    },
    ALL_ON,
    "the four faculty gates after a reset that followed all four being " +
      "turned off: each is on by default and restored to on by reset " +
      "(specs/instrumentation.md)",
  );
});
