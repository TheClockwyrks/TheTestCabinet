// Automated validation for the Victory-cascade sub-item `floor-bounce`.
//
// When a falling card's bottom edge reaches the floor while moving down, it bounces:
// vy is reflected and damped to 0.80× and the card is reseated on the floor, while vx
// is unchanged (no floor friction) — specs/victory.md. The validate pass advances by
// exact ticks, so the first flyer is stepped one tick at a time until its vy flips
// from downward (>0) to upward (<0) — the bounce — and the exact relation is
// asserted. The record pass replays the same advance in real time, so the clip shows
// the cards falling and bouncing at the speed the game runs them.
//
// The bounce hunt lives in `actFirstBounce`: a bounce is defined by comparing the
// PREVIOUS tick to the current one, which an `api.until` predicate cannot express
// (it sees only the current snapshot).
//
// UNITS: `advance` counts TICKS; `FIXED_DT` (1/120 s) is the timestep in SECONDS and
// appears only in the physics math, never as an amount to advance by.

import {
  BOUNCE_DAMP,
  FIXED_DT,
  FLOOR_Y,
  GRAVITY,
  actFirstBounce,
  actFirstFlyer,
  ticksFor,
  winBoard,
} from "../_helpers.mjs";

// The old clip tail's 2.5 s of live cascade, in ticks: 2500 ms x 120 Hz = 300 exactly.
// The bounce hunt itself already films the first card's flight; this keeps the cascade
// running afterwards so the clip shows the table full of bouncing cards.
const CLIP_TICKS = ticksFor(2500);

export default function item() {
  // The flyer either side of the bounce tick, and whether one was found at all.
  let prev;
  let cur;
  let bounced;

  return {
    id: "cascade.floor-bounce",

    async arrange(api) {
      await winBoard(api, 3);
    },

    async act(api) {
      await actFirstFlyer(api); // launch the first card
      ({ prev, cur, bounced } = await actFirstBounce(api));

      // Keep the cascade running so the clip shows the bouncing.
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      // A floor bounce is the step where downward motion (vy > 0) becomes upward
      // (vy < 0). Gravity is applied first this step, so the pre-bounce vertical speed
      // is prev.vy + 1800·dt. These three hold only of an actual bounce, so — as in the
      // original loop, which asserted them only on the bouncing step — they are skipped
      // when no bounce was found and the summary check below carries the failure.
      if (bounced) {
        const preBounceVy = prev.vy + GRAVITY * FIXED_DT;
        check.expectClose(
          "the bounce reflects and damps vy to 0.80× (upward)",
          cur.vy,
          -preBounceVy * BOUNCE_DAMP,
          1e-3,
        );
        check.expectClose(
          "the horizontal velocity is unchanged (no floor friction)",
          cur.vx,
          prev.vx,
          1e-6,
        );
        check.expectClose(
          "the card is reseated on the floor",
          cur.y,
          FLOOR_Y,
          1e-6,
        );
      }

      check.expectOk("the first card bounced off the floor", bounced);
    },
  };
}
