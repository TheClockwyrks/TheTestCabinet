// Automated validation for the Controls sub-item `fire-cadence`.
//
// Held fire spaces shots by a fire cadence of about 0.16s rather than firing every
// frame. Fire is held and the real sim stepped in fixed increments; the times of
// the first and second shots are read from the friendly-bullet count and their gap
// checked against the cadence.

import {
  startClean,
  friendlyBullets,
  actHoldSample,
  TICK,
  SEC_PER_TICK,
  FIRE_CADENCE,
} from "../_helpers.mjs";

// The old loop ran 100 iterations of one fixed step; one fixed step is exactly one
// tick, so the window is 100 ticks unchanged.
const WINDOW_TICKS = 100;

// NOTE ON UNITS. The cadence is the one duration in this case that is NOT a whole
// number of ticks: 0.16 s x 120 Hz = 19.2. There is deliberately no
// `FIRE_CADENCE_TICKS` — the check does not step by the cadence, it MEASURES the gap
// between two shots and compares it, in seconds, against the seconds the spec
// states. So the sweep steps one tick at a time (the finest resolution the
// simulation has, which is what bounds the measurement error) and accumulates
// `SEC_PER_TICK` to express the shot times back in seconds.

export default function item() {
  // The elapsed SECONDS at which the first and second shots appeared.
  let t1 = null;
  let t2 = null;

  return {
    id: "controls.fire-cadence",

    // A clean wave with the ship centered, so nothing on the field can consume a
    // bullet and perturb the count the cadence is read from.
    async arrange(api) {
      await startClean(api);
      await api.call("setShipX", 640);
    },

    async act(api) {
      // Hold fire and watch the friendly-bullet count tick by tick, recording when
      // it first reaches one and then two. The `else if` is preserved from the old
      // loop: it stops the same tick from being credited as both shots.
      await actHoldSample(api, "Space", {
        ticks: WINDOW_TICKS,
        poll: TICK,
        sample: (snap, elapsedTicks) => {
          const t = elapsedTicks * SEC_PER_TICK;
          const n = friendlyBullets(snap).length;
          if (t1 === null && n >= 1) t1 = t;
          else if (t1 !== null && n >= 2) t2 = t;
          return t2 !== null; // both shots known — stop early
        },
      });

      // The sweep above stops the instant the second shot lands (~0.17 s in), which
      // is too brief to read as a clip. Hold fire for a further readable moment so
      // the reviewer can actually see the spacing between shots. Both operands are
      // already captured, so this cannot affect the verdict.
      await api.call("keyDown", "Space");
      await api.advance(108); // 108 ticks = the old 900 ms of held fire
      await api.call("keyUp", "Space");
    },

    async assert(api, check) {
      check.expectOk(
        "two shots were fired while holding",
        t1 !== null && t2 !== null,
      );
      if (t1 !== null && t2 !== null) {
        check.expectClose(
          "consecutive shots are spaced by the fire cadence",
          t2 - t1,
          FIRE_CADENCE,
          0.02,
        );
      }
    },
  };
}
