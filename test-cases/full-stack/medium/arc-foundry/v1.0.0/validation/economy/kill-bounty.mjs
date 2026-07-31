// Automated validation for economy.kill-bounty: destroying a unit pays exactly its bounty in
// Charge the instant it dies (a Mote pays 1).
//
// `armTower` leaves a strong Capacitor standing on an empty floor, TWO Motes are released a beat
// apart, and their walk to the edge of the tower's reach is skipped. The Charge is read before
// the leading Mote dies and again the instant it does — that delta is one Mote's bounty.
//
// WHY TWO MOTES. Releasing one and measuring across its death measured two payouts, not one. The
// debug spawner puts its units into a live wave with nothing else scheduled, so the ONLY unit on
// the floor dying is also the floor going empty — which ends the wave, and clearing a wave pays
// its bonus (`specs/gameplay.md`, `economy/wave-clear-bonus`). Both land on the same tick, so no
// poll however fine can read between them: against the run implementation the delta came back as
// 11, the Mote's 1 plus Wave 1's 8 + 2*1. The check was sound and the pose was wrong.
//
// A second Mote a beat behind fixes it at the root: the leading one's death leaves the floor
// occupied, so the wave cannot clear and the only thing the window can contain is the one bounty
// the item is about. The trailing Mote also keeps the clip honest — the shot that pays is visibly
// one kill out of the traffic, not the last event before the board empties.
//
// Releasing the Motes is a control op (the arrange); waiting for the kill is the behavior under
// test, so it is the act, and the clip shows the pair walk in, the leader take the shot, and pop.

import {
  armTower,
  spawnControlled,
  skipToApproach,
  unitById,
  snap,
  unmetPrecondition,
  TICK,
  SECOND,
} from "../_helpers.mjs";

// How far behind the leader the second Mote is released. Half a second at 60 px/s is ~30 px: far
// enough that the tower's `first` priority (the default) unambiguously prefers the leader, close
// enough that both are on screen together for the whole clip.
const TRAIL_TICKS = 0.5 * SECOND;
// Several Capacitor cadences, so a build that opens a component on a full cooldown still gets
// its shot away inside the budget.
const KILL_TICKS = 4 * SECOND;
// A beat after the kill, so the clip carries the death rather than cutting on it.
const TAIL_TICKS = 1.5 * SECOND;

export default function item() {
  // The units `act` follows, the Charge either side of the kill, and what the window held.
  let leadId;
  let trailId;
  let c0;
  let c1;
  let killed;
  let floorHeld;

  return {
    id: "economy.kill-bounty",

    async arrange(api) {
      const towerId = await armTower(api, { type: "capacitor", tier: 3 }); // one-shots a Mote
      const [lead] = await spawnControlled(api, "mote");
      leadId = lead.id;
      await api.skip(TRAIL_TICKS); // the leader walks ahead
      const [trail] = await spawnControlled(api, "mote");
      if (!trail) {
        throw unmetPrecondition(
          "only one Mote could be released, so the floor would empty on the kill and the " +
            "wave-clear bonus would land in the same tick as the bounty",
        );
      }
      trailId = trail.id;
      // Walk the pair up together, stopping short of the TRAILING unit's reach so neither has
      // been shot at yet and both are on screen when the act opens.
      await skipToApproach(api, towerId, trailId);
      // Read the Charge AFTER the approach: the walk is real simulation, and a build that
      // paid anything during it would otherwise land in the delta.
      c0 = (await snap(api)).charge;
    },

    async act(api) {
      const r = await api.until((s) => !unitById(s, leadId), { max: KILL_TICKS, poll: TICK });
      killed = r.hit;
      const s = await snap(api);
      c1 = s.charge;
      // The trailing Mote is what keeps the wave alive across the measurement. If it were
      // already gone the delta could carry a wave-clear bonus and the reading would mean
      // something else entirely — so the check reports that rather than trusting the number.
      floorHeld = Boolean(unitById(s, trailId));

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the tower destroyed the unit", killed);
      check.expectOk("...with the wave still live, so no clear bonus is in the delta", floorHeld);
      check.expectEq("the kill paid the Mote's bounty (1 Charge)", c1 - c0, 1);
    },
  };
}
