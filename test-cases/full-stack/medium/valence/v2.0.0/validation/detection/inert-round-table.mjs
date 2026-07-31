// Automated validation for the Detection sub-item `inert-round-table`.
//
// The companion to `inert-modifier`. That item proves the inert MODIFIER on posed matter
// — a Dimer released shielded carries the trait, cannot be touched, and is chipped once a
// detector reveals it. This one proves the ROUND TABLE uses it: Round 37 fields both
// plain and shielded Dimers (specs/matter.md), and it is the real wave system, not a
// posed unit, that has to release them that way.
//
// So this is one of the few items that drives a REAL round rather than a scenario round:
// the wave under test IS the point, and `startRun` leaves the run on the opening build
// phase for `startRound` to send it from. It was split out of `inert-modifier`, where a
// broken wave and a broken modifier failed the same single point and neither verdict said
// which had gone wrong.

import { startRun, MAP } from "../_helpers.mjs";

// 5400 ticks = 90 s of GAME time (not wall clock) for Round 37's wave to reach both
// kinds of Dimer. Polled every 15 ticks (0.25 s): the sweep only needs to catch each
// type once as it is released, not the exact tick it appeared.
const MAX_WAVE_TICKS = 5400;
const WAVE_POLL = 15;

export default function item() {
  let sawPlain;
  let sawShielded;
  let swept;

  return {
    id: "detection.inert-round-table",

    async arrange(api) {
      // Integrity is set far out of reach: a whole round runs here with no towers built,
      // so every unit leaks, and the item is about what was SENT, not about surviving it.
      await startRun(api, MAP.single, { round: 37, integrity: 1e9 });
      sawPlain = false;
      sawShielded = false;
    },

    async act(api) {
      await api.call("startRound");
      swept = await api.until(
        (s) => {
          for (const u of s.matter) {
            if (u.type !== "dimer") continue;
            if (u.traits.inert) sawShielded = true;
            else sawPlain = true;
          }
          return sawPlain && sawShielded;
        },
        { max: MAX_WAVE_TICKS, poll: WAVE_POLL },
      );
    },

    async assert(api, check) {
      check.expectOk("the round table releases plain Dimers", sawPlain);
      check.expectOk(
        "...and shielded ones, from the same roster entry",
        sawShielded,
      );
      check.expectOk("both were seen in the one Round 37 wave", swept.hit);
    },
  };
}
