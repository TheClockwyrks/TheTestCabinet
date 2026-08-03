// Automated validation for the Economy sub-item `bounty`.
//
// Killing a unit pays its kill bounty (specs/economy.md — a Mote pays 3). From zero
// money we kill a single real Mote with an Arc and confirm exactly its bounty lands.
//
// The Arc is set into a vent corridor rather than parked beside the lane a Mote would
// walk if it crossed on its entry rows: this item needs a kill, and a build is free to
// route the Mote off those rows without being wrong (see the note above
// `buildVentCorridor` in `_helpers`). Aimed at the assumed lane, the Arc on such a
// build never fires, nothing dies, and an economy item reports a payout defect that is
// really an emitter with nothing in range.
//
// The corridor's own sinks cost money, so the balance is zeroed AFTER it is built —
// whatever money appears during the drive is then the bounty and can be nothing else.

import {
  newGame,
  buildVentCorridor,
  spawn,
  actTail,
  CORRIDOR_WALLS,
  TICK,
} from "../_helpers.mjs";

export default function item() {
  let walls;
  let r;
  let money;

  return {
    id: "economy.bounty",

    // A hot emitter kills a Mote seconds after it walks in, plus the 2 s tail on the
    // kill and its payout. The ceiling covers a build whose Mote takes the scenic route
    // to get there.
    clipMs: 7000,

    // One Arc, hot enough to kill, one Mote, and a zeroed balance — so whatever money
    // appears IS the bounty, with nothing else able to contribute.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      const corridor = await buildVentCorridor(api, "arc");
      walls = corridor.walls;
      await api.call("setHeat", corridor.id, 80);
      await api.call("setMoney", 0);
      await spawn(api, "mote", "left");
    },

    // 360 ticks = the old 6s cap; polling every tick reads the balance at the kill
    // rather than after anything else could have paid out.
    //
    // Then a tail, because `until` returns on the FIRST tick the balance moves and
    // `act` returning ends the record pass — so without it the clip cut on the frame
    // the Mote's last hit landed. What a reviewer saw was a Mote taking a couple of
    // shots and the clip stopping, with the death and the payout the item is about
    // both falling after the final frame. 120 ticks is long enough for the Mote to
    // come apart and the money read to settle at 3 and be legible there.
    async act(api) {
      r = await api.until((s) => s.money > 0, { max: 360, poll: TICK });
      money = (await api.snapshot()).money;
      await actTail(api, 120); // 2 s on the kill and the 3 it paid
    },

    async assert(api, check) {
      // A hole in the corridor lets the Mote walk round the Arc, and "nothing was paid"
      // would then be about the scenery rather than about the bounty.
      check.expectEq("the vent corridor was built", walls, CORRIDOR_WALLS);
      check.expectOk("killing the Mote paid out", r.hit);
      check.expectEq("a Mote kill pays exactly its bounty (3)", money, 3);
    },
  };
}
