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

import { startRun, clipBudget, TAIL_TICKS, MAP } from "../_helpers.mjs";

// 5400 ticks = 90 s of GAME time (not wall clock) for Round 37's wave to reach both
// kinds of Dimer. Polled every 15 ticks (0.25 s): the sweep only needs to catch each
// type once as it is released, not the exact tick it appeared.
const MAX_WAVE_TICKS = 5400;
const WAVE_POLL = 15;

// WHY THE WAVE IS SKIPPED AND ONLY THE BOUNDARY IS FILMED.
//
// Round 37 is "50 Dimer, 7 shielded Dimer, 25 Isotope" (specs/matter.md), released one
// group at a time in that order at 320 ms a unit. So the first shielded Dimer arrives some
// SIXTEEN SECONDS of game time after the round starts — twice the record pass's whole
// budget. Filmed from the top, the clip was fifty plain Dimers and then it ran out, which
// is precisely the review's "visually all the atoms look the exact same": the shielded ones
// the item is about never made it into the recording at all.
//
// `skipUntil` runs the identical simulation instantly and films none of it, so the clip
// opens at the group boundary — where the tail of the plain group and the head of the
// shielded one are on the lane together, which is the one moment that shows the difference
// rather than describing it.
//
// (Whether the two are DRAWN differently enough to tell apart is a different requirement,
// graded by `matter-art.trait-reads`; specs/matter.md requires "a shroud/cloak mark on
// inert matter". This item is about what the round table SENDS, and it reads that off
// `traits.inert` in the snapshot, so its verdict never depended on the picture.)
const BOTH_ON_LANE_TICKS = 240;

export default function item() {
  let sawPlain;
  let sawShielded;
  let swept;

  return {
    id: "detection.inert-round-table",

    clipMs: clipBudget(BOTH_ON_LANE_TICKS + TAIL_TICKS),

    async arrange(api) {
      // Integrity is set far out of reach: a whole round runs here with no towers built,
      // so every unit leaks, and the item is about what was SENT, not about surviving it.
      await startRun(api, MAP.single, { round: 37, integrity: 1e9 });
      sawPlain = false;
      sawShielded = false;
    },

    async act(api) {
      await api.call("startRound");
      swept = await api.skipUntil(
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
      // Both kinds are now on the lane at once. This is the whole clip.
      await api.advance(BOTH_ON_LANE_TICKS);
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
