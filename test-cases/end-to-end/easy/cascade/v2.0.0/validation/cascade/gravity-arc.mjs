// Automated validation for the Victory-cascade sub-item `gravity-arc`.
//
// A launched card pops up (its initial vy is a slight upward −120) then falls under
// gravity: every fixed step, vy += 1800·dt (specs/victory.md). The validate pass
// advances by exact ticks, so vy is asserted exactly; the record pass replays the
// same advance in real time, so the clip shows the arc at the speed the game runs it.
//
// UNITS: `advance` counts TICKS. `FIXED_DT` (1/120 s) is the timestep in SECONDS and
// appears only in the physics math the spec states — never as an amount to advance by.
// Four more steps is `advance(4)`, exactly four ticks.

import {
  FIXED_DT,
  GRAVITY,
  LAUNCH_VY,
  actFirstFlyer,
  ticksFor,
  winBoard,
} from "../_helpers.mjs";

// The old clip tail's 2.5 s of live cascade, in ticks: 2500 ms x 120 Hz = 300 exactly.
// Five ticks of arc is 42 ms of footage, far too little to see, so the item keeps
// filming the cascade it just measured rather than cutting away.
const CLIP_TICKS = ticksFor(2500);

export default function item() {
  // The first flyer one tick after launch, and again four ticks later.
  let f1;
  let f5;

  return {
    id: "cascade.gravity-arc",

    // Pose the real win. Every op is instant and the cascade it starts has advanced
    // by nothing, so `act` owns the whole arc.
    async arrange(api) {
      await winBoard(api, 7);
    },

    async act(api) {
      // One tick launches the first card and applies one step of gravity.
      f1 = await actFirstFlyer(api);

      // Four more ticks: vy must increase by exactly four steps of gravity (still in
      // free flight, well before any floor bounce).
      await api.advance(4);
      f5 = (await api.snapshot()).cascade.flyers[0];

      // Keep the cascade running so the clip shows the arc.
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectClose(
        "vy after one step is the launch pop plus one step of gravity",
        f1.vy,
        LAUNCH_VY + GRAVITY * FIXED_DT,
        1e-6,
      );
      // The card starts at the foundation's top-y (24) and pops UP, so its y dips above
      // its start (a smaller y) while vy is still negative.
      check.expectLt(
        "the card has popped up (y above its launch position)",
        f1.y,
        24,
      );

      check.expectClose(
        "vy after five steps follows gravity exactly",
        f5.vy,
        LAUNCH_VY + GRAVITY * 5 * FIXED_DT,
        1e-6,
      );
      check.expectClose(
        "each step adds exactly 1800·dt to vy",
        f5.vy - f1.vy,
        GRAVITY * 4 * FIXED_DT,
        1e-6,
      );
    },
  };
}
