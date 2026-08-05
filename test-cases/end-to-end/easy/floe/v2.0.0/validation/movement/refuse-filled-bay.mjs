// Automated validation for the Movement item `refuse-filled-bay`.
//
// Hopping up into an already-filled bay is refused, while an open bay accepts the
// hop. Both are driven through the real play code: the critter is stood on a floe
// below bay 0's column and a real up-hop is attempted, first with the bay filled
// (refused) then open (accepted). See validation/_helpers.mjs.
//
// THE HOP IS AIMED AT `BAY_COL[0]`, the column bay 0's opening straddles under either
// reading of specs/playfield.md's "centered near columns 4, 12, …" — see `BAY_COL`.
// Aimed at one reading's left column instead, the accepted half of this item lands on
// solid shore against a build that read it the other way, and the item fails on the
// bay layout rather than on the rule it is checking.
//
// BOTH HALVES HAVE TO BE VISIBLE, not just decided. The refusal is a non-event — the
// critter ends where it began — so it only reads as one beside the same hop being
// accepted a moment later, off the same tile, with nothing changed but the bay. The
// two halves are therefore framed alike: the posed bay is held on camera, the key is
// held down against it, and the second half runs on long enough for the bay to
// visibly fill and the next crossing to begin.

import {
  actRefusedHop,
  startCrossing,
  BAY_COL,
  REFUSE_LEAD_TICKS,
  WATER_TOP,
} from "../_helpers.mjs";

// Bay 0, and the column its opening straddles under either reading.
const BAY_INDEX = 0;
const COL = BAY_COL[BAY_INDEX];

// The refused half's tail is short — the accepted half opens with its own lead on the
// same tile. The accepted half's hop is given the usual beat to resolve, then a long
// hold: filling a bay ends the crossing, so the tail is what shows the bay taken and
// the fresh critter back on the near shore.
const REFUSED_TAIL_TICKS = 24; // 0.2 s
const FILL_TICKS = 18; // 0.15 s, just past the hop cooldown
const FILL_TAIL_TICKS = 144; // 1.2 s

export default function item() {
  // The state after each of the two hops.
  let sFilled;
  let sOpen;

  return {
    id: "movement.refuse-filled-bay",

    // Filled bay: the hop should be refused. The floe under the bay's column is what
    // lets the critter stand there at all.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setBear", 0, null); // nothing but the bay decides this item
      await api.call("setBays", [true, false, false, false, false]);
      await api.call("setLane", WATER_TOP, { cols: [COL], speed: 0 });
      await api.call("placeCritter", COL, WATER_TOP);
    },

    // The same hop against a filled bay and then an open one, back to back — which is
    // what makes the refusal legible: the difference is the bay, not the input. The
    // second pose is `setBays` + `placeCritter`, control ops only; the old script
    // re-ran `startCrossing`, whose reset would freeze the recording here.
    async act(api) {
      sFilled = await actRefusedHop(api, "ArrowUp", {
        tail: REFUSED_TAIL_TICKS,
      });

      // Open bay: the same hop, off the same tile, is accepted (the bay fills).
      await api.call("setBays", [false, false, false, false, false]);
      await api.call("placeCritter", COL, WATER_TOP);
      await api.advance(REFUSE_LEAD_TICKS); // camera only: the bay, now open
      await api.call("press", "ArrowUp");
      await api.advance(FILL_TICKS);
      sOpen = await api.snapshot();
      await api.advance(FILL_TAIL_TICKS); // camera only: the bay taken, the next crossing
    },

    async assert(api, check) {
      check.expectEq(
        "a hop into a FILLED bay is refused (row unchanged)",
        sFilled.critter.row,
        WATER_TOP,
      );
      check.expectEq("no death", sFilled.screen, "playing");
      check.expectEq(
        "an OPEN bay accepts the hop (bay 0 fills)",
        sOpen.bays[BAY_INDEX],
        true,
      );
    },
  };
}
