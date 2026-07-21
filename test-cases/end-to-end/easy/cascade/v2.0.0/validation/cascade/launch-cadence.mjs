// Automated validation for the Victory-cascade sub-item `launch-cadence`.
//
// Cards launch one at a time on a steady 0.18 s cadence (specs/victory.md). The
// validate pass advances one tick at a time and records the moment each new card
// launches; the average gap between successive launches must be ~0.18 s. The record
// pass replays the same advance in real time, so the clip shows the cascade launching
// at the cadence being measured.
//
// UNITS — the one place in this case where ticks and seconds must both appear. The
// cadence is measured in TICKS (tick granularity is required: 0.18 s is 21.6 ticks,
// finer than any coarser poll resolves), but the assertion is STATED in seconds, and
// 21.6 is not a whole number, so there is no honest integer tick constant to compare
// against. `LAUNCH_INTERVAL` therefore stays in seconds, the measured tick span is
// converted back with `secondsOf`, and the tolerance stays `FIXED_DT * 1.5` — the same
// operands the original asserted. Do not "tidy" this into ticks: the operands would
// have to be rounded, and the check would stop testing the spec's number.

import {
  FIXED_DT,
  LAUNCH_INTERVAL,
  actLaunchTicks,
  secondsOf,
  ticksFor,
  winBoard,
} from "../_helpers.mjs";

// The old clip tail's 2.5 s of live cascade, in ticks: 2500 ms x 120 Hz = 300 exactly.
const CLIP_TICKS = ticksFor(2500);

export default function item() {
  // The launch instants (ticks since the cascade started) and the cascade's own
  // launched counter, so a check can confirm cards launch one at a time as well as
  // on cadence.
  let ticks;
  let launched;

  return {
    id: "cascade.launch-cadence",

    async arrange(api) {
      await winBoard(api, 5);
    },

    async act(api) {
      ({ ticks, launched } = await actLaunchTicks(api));

      // Keep the cascade running so the clip shows the steady launching.
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectGe("several cards launched on cadence", ticks.length, 8);
      check.expectEq("cards launch one at a time", launched, ticks.length);

      // Average the gaps between steady launches (skip the very first, off-phase gap).
      let sum = 0;
      let n = 0;
      for (let k = 2; k < ticks.length; k += 1) {
        sum += ticks[k] - ticks[k - 1];
        n += 1;
      }
      const avgGap = secondsOf(sum / n);
      // Advancing by whole ticks makes the measurement exact, so the discretized
      // cadence sits within one fixed step of the ideal 0.18 s.
      check.expectClose(
        "the launch cadence is ~0.18 s per card",
        avgGap,
        LAUNCH_INTERVAL,
        FIXED_DT * 1.5,
      );
    },
  };
}
