// Automated validation for the Combo sub-item `window-duration`.
//
// The combo window is 3.5 seconds of game time — 28 ticks. Two real eats open the
// window and raise the multiplier to x2, then single ticks are stepped without eating
// (actDriftTicks repositions to a clear lane and parks the pellet, leaving combo state
// untouched so the real window drain resolves). The window is read back tick by tick:
// still open through 27 total ticks, closed (and the multiplier reset) at 28 — 3.5 s.
// All exact under the manual clock.
//
// The lane is posed instantly (`arrange`); the eats and the 27 drift ticks consume
// time and are the clip. What the RECORDED clip shows is the snake crossing the board
// (actDriftTicks re-poses it to the start of the lane only as it nears the right wall,
// not every tick) while the HUD's combo meter drains to zero and the multiplier drops
// back to x1 — which is the evidence this item is about. The clip is left uncapped for
// that reason; at 29 ticks it is ~3.6 s, comfortably inside the runtime's budget.
//
// The two eats that open the window are waited FOR rather than assumed to land on the
// record pass's wall clock (see `actEatSequence`); without that the recording could
// reach the drain at x1 with a single eat scored, and show no multiplier to reset.

import {
  actDriftTicks,
  actEatSequence,
  arrangeEatLane,
  beginRound,
} from "../_helpers.mjs";

export default function item() {
  // The window right after the second eat, and the per-tick snapshots of the drain.
  let w0;
  let snaps;

  return {
    id: "combo.window-duration",

    async arrange(api) {
      await beginRound(api);
      await arrangeEatLane(api); // the lane the old eatSequence posed for itself
    },

    async act(api) {
      // Opens the window; the 2nd eat is tick 1 of its life.
      await actEatSequence(api, { count: 2 });
      // comboWindow is reported in simulation SECONDS, so this reading (and the
      // assertion below) stays in seconds even though the drive is in ticks.
      w0 = (await api.snapshot()).comboWindow;

      // Step single non-eat ticks. The eat itself was tick 1 of the window's life, so 26
      // more ticks is 27 total (still open) and 27 more is 28 total (3.5 s — closed).
      snaps = await actDriftTicks(api, 27);
    },

    async assert(api, check) {
      check.expectGt("the window reopened near full on the eat", w0, 3.0);
      check.expectGt(
        "still open after 27 ticks total",
        snaps[25].comboWindow,
        0,
      );
      check.expectEq(
        "the multiplier holds while the window is open",
        snaps[25].combo,
        2,
      );
      check.expectEq(
        "closed after 28 ticks total (3.5 s)",
        snaps[26].comboWindow,
        0,
      );
      check.expectEq(
        "the multiplier reset when the window closed",
        snaps[26].combo,
        1,
      );
    },
  };
}
