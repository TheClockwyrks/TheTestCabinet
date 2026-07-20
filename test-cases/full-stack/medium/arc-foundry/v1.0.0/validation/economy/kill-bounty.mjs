// Automated validation for economy.kill-bounty: destroying a unit pays exactly its bounty in
// Charge the instant it dies (a Mote pays 1).
//
// A strong entry-adjacent tower is armed and a Mote released at the Entry (in range at once);
// the Charge is read before the kill and after — the delta is the Mote's bounty. Measured
// inside the ~0.6 s window before the kept level's own Wave 1 begins, so no other unit dies.
//
// Arming the tower and releasing the Mote are control ops (the arrange); waiting for the kill
// is the behavior under test, so it is the act, and the clip is the kill itself and nothing
// else — well inside the quiet window, so no other unit is on the floor to muddy it.

import { armTower, spawnControlled, unitById, snap, TICK } from "../_helpers.mjs";

// The old script stepped one tick at a time up to 40 times; the budget is the same 40 ticks,
// polled every tick because the instant of the kill is what the Charge delta is read against.
const KILL_TICKS = 40;

export default function item() {
  // The unit `act` follows, the Charge either side of the kill, and whether it died.
  let unitId;
  let c0;
  let c1;
  let killed;

  return {
    id: "economy.kill-bounty",

    async arrange(api) {
      await armTower(api, { type: "capacitor", tier: 3 }); // one-shots a Wave-1 Mote
      c0 = (await snap(api)).charge;
      const [u] = await spawnControlled(api, "mote");
      unitId = u.id;
    },

    async act(api) {
      const r = await api.until((s) => !unitById(s, unitId), { max: KILL_TICKS, poll: TICK });
      killed = r.hit;
      c1 = (await snap(api)).charge;
    },

    async assert(api, check) {
      check.expectOk("the tower destroyed the unit", killed);
      check.expectEq("the kill paid the Mote's bounty (1 Charge)", c1 - c0, 1);
    },
  };
}
