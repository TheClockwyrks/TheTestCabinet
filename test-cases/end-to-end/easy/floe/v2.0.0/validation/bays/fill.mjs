// Automated validation for the Bays item `fill`.
//
// Hopping up into an open far-shore bay completes the crossing, fills the bay, and
// scores. The critter is stood on a floe below bay 0 and a real up-hop fills it,
// which the snapshot reads back. See validation/_helpers.mjs.

import { startCrossing, BAY_COL, WATER_TOP } from "../_helpers.mjs";

// Bay 0, entered at the column its opening straddles under either reading of
// specs/playfield.md's bay layout (see `BAY_COL`).
const COL = BAY_COL[0];

// The beats either side of the hop.
//
// THE HOP WAS OVER BEFORE THE CLIP BEGAN. `act` is the recording, and it used to open
// on the press itself: a tenth of a second in which the critter is already in the bay,
// which reads as a critter that was always there. The lead holds on the floe parked
// under the open bay first, so the gap the critter has to cross is on camera before it
// crosses it; the tail then holds on the filled bay and the score it paid out.
const LEAD_TICKS = 72; // 0.6 s under the open bay
const HOP_TICKS = 24; // 0.2 s, long enough for the hop and the fill to resolve
const TAIL_TICKS = 144; // 1.2 s on the filled bay

export default function item() {
  // Bay 0's state before the hop (read instantly in `arrange`, since the hop is what
  // fills it), and the snapshot `act` took afterwards.
  let bayOpenBefore;
  let after;

  return {
    id: "bays.fill",

    // Pose the completed crossing minus its last hop: the score zeroed so the award
    // reads as a delta from nothing, a stationary floe below bay 0's column, and the
    // critter standing on it.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setScore", 0);
      await api.call("setLane", WATER_TOP, { cols: [COL], speed: 0 }); // floe below bay 0
      await api.call("placeCritter", COL, WATER_TOP);
      bayOpenBefore = (await api.snapshot()).bays[0];
    },

    // The single real hop into the bay — the crossing completing, which is both what
    // is checked and all the clip needs to show.
    async act(api) {
      await api.advance(LEAD_TICKS); // camera only: the critter waiting under the open bay
      await api.call("press", "ArrowUp");
      await api.advance(HOP_TICKS);
      after = await api.snapshot();
      await api.advance(TAIL_TICKS); // camera only: the bay taken, and the score for it
    },

    async assert(api, check) {
      check.expectEq("bay 0 starts open", bayOpenBefore, false);
      check.expectEq(
        "hopping up into an open bay fills it",
        after.bays[0],
        true,
      );
      check.expectGt("filling a bay awards score", after.score, 0);
    },
  };
}
