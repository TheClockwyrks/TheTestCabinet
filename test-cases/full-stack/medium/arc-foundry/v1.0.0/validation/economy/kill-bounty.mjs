// Automated validation for economy.kill-bounty: destroying a unit pays exactly its bounty in
// Charge the instant it dies (a Mote pays 1).
//
// `armTower` leaves a strong Capacitor standing on an empty floor, a Mote is released at the
// Entry, and its walk to the edge of the tower's reach is skipped. The Charge is read before
// the kill and after — the delta is the Mote's bounty, and with nothing else on the floor no
// other death can contribute to it.
//
// Releasing the Mote is a control op (the arrange); waiting for the kill is the behavior under
// test, so it is the act, and the clip shows the Mote walk in, take the shot, and pop.

import {
  armTower,
  spawnControlled,
  skipToApproach,
  unitById,
  snap,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// Several Capacitor cadences, so a build that opens a component on a full cooldown still gets
// its shot away inside the budget.
const KILL_TICKS = 4 * SECOND;
// A beat after the kill, so the clip carries the death rather than cutting on it.
const TAIL_TICKS = 1.5 * SECOND;

export default function item() {
  // The unit `act` follows, the Charge either side of the kill, and whether it died.
  let unitId;
  let c0;
  let c1;
  let killed;

  return {
    id: "economy.kill-bounty",

    async arrange(api) {
      const towerId = await armTower(api, { type: "capacitor", tier: 3 }); // one-shots a Mote
      const [u] = await spawnControlled(api, "mote");
      unitId = u.id;
      await skipToApproach(api, towerId, unitId);
      // Read the Charge AFTER the approach: the walk is real simulation, and a build that
      // paid anything during it would otherwise land in the delta.
      c0 = (await snap(api)).charge;
    },

    async act(api) {
      const r = await api.until((s) => !unitById(s, unitId), { max: KILL_TICKS, poll: TICK });
      killed = r.hit;
      c1 = (await snap(api)).charge;

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the tower destroyed the unit", killed);
      check.expectEq("the kill paid the Mote's bounty (1 Charge)", c1 - c0, 1);
    },
  };
}
