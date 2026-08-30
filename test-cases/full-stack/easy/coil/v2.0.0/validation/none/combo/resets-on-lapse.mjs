// Automated validation for the Combo sub-item `resets-on-lapse`.
//
// Wandering without eating until the combo window lapses drops the multiplier back to
// x1 and closes the window. The multiplier is raised to x2 by two real eats, then the
// snake wanders for well over the 3.5 s window without eating (actDriftTicks steps
// single ticks, repositioning to a clear lane and parking the pellet so nothing is
// eaten and the snake never dies — combo state is untouched, so the real window drain
// resolves the reset). The final multiplier and window are read back.
//
// The lane is posed instantly (`arrange`); the eats and the 32 drift ticks consume time
// and are the clip. As in window-duration, the drift lets the snake cross the board and
// re-poses it to the start of the lane only as it nears the right wall, so it stays
// clear of the walls and the pellet for the whole lapse while the evidence a reviewer
// wants — the combo meter draining and the multiplier dropping to x1 — plays out in
// full. At 34 ticks the clip is ~4.25 s, inside the runtime's budget, so it is left
// uncapped.
//
// The two eats that raise the multiplier are waited FOR rather than assumed to land on
// the record pass's wall clock (see `actEatSequence`); without that the recording could
// enter the lapse already at x1, with nothing left to reset on camera.

import {
  actDriftTicks,
  actEatSequence,
  arrangeEatLane,
  beginRound,
} from "../_helpers.mjs";

export default function item() {
  // The per-eat multipliers, and the snapshot after the last drift tick.
  let combos;
  let last;

  return {
    id: "combo.resets-on-lapse",

    async arrange(api) {
      await beginRound(api);
      await arrangeEatLane(api); // the lane the old eatSequence posed for itself
    },

    async act(api) {
      ({ combos } = await actEatSequence(api, { count: 2 }));

      // Wander 32 ticks (4.0 s) — comfortably past the 3.5 s window — without eating.
      const snaps = await actDriftTicks(api, 32);
      last = snaps[snaps.length - 1];
    },

    async assert(api, check) {
      check.expectGe(
        "two quick eats raised the multiplier to at least x2",
        combos[1],
        2,
      );
      check.expectEq(
        "the multiplier reset to x1 after the window lapsed",
        last.combo,
        1,
      );
      // comboWindow is reported in simulation SECONDS; closed is exactly 0.
      check.expectEq("the combo window is closed", last.comboWindow, 0);
    },
  };
}
