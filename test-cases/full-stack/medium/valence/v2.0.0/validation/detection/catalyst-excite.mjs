// Automated validation for the Detection sub-item `catalyst-excite`.
//
// Matter in a Catalyst's field is excited — it takes extra damage per hit while in the
// aura (specs/towers.md: "excites every unit in the field (`+1` to the damage each hit
// deals it)"). The check walks an atom into the field and reads `damageBonus` on each
// side of the boundary.
//
// THE ATOM STARTS OUTSIDE THE FIELD, for the same two reasons as `detection.catalyst`. The
// clip needs an un-excited state for the excited one to be a change from — posed inside the
// aura and read three ticks later, the whole recording was 1/20th of a second of a unit
// that was already excited. And the check needs it too: reading a positive `damageBonus`
// on a unit posed inside the field is satisfied by a build that hands every unit a
// permanent +1 and has no aura at all. Crossing the boundary is what makes the reading
// about the Catalyst.

import {
  startScenario,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  towerById,
  preconditionUnmet,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  MAP,
} from "../_helpers.mjs";

const APPROACH_PX = 90;
const MAX_EXCITE_TICKS = 300; // 5 s — the walk-in plus the aura applying

export default function item() {
  let unitId;
  let bonusOutside;
  let bonusInside;
  let entered;

  return {
    id: "detection.catalyst-excite",

    clipMs: clipBudget(LEAD_TICKS + MAX_EXCITE_TICKS + TAIL_TICKS),

    async arrange(api) {
      const snap = await startScenario(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.3;
      const cat = await placeCovering(api, "catalyst", g, s0);

      const catalyst = towerById(await api.snapshot(), cat.id);
      const startAt = s0 - (catalyst.range + APPROACH_PX);
      if (startAt < 0) {
        throw preconditionUnmet(
          `the lane has no room upstream of the Catalyst to pose an un-excited approach ` +
            `(needs ${Math.round(catalyst.range + APPROACH_PX)}px before s=${Math.round(s0)})`,
        );
      }

      // Six electrons: the slowest atom, so the approach is long enough to watch. There is
      // no damage tower in this scene, so nothing strips it on the way.
      unitId = await spawnAt(api, {
        type: "atom",
        electrons: 6,
        pathId: 0,
        s: startAt,
      });
      bonusOutside = unitById(await api.snapshot(), unitId).damageBonus;
    },

    async act(api) {
      // Outside the field, unexcited.
      await api.advance(LEAD_TICKS);

      entered = await api.until(
        (s) => {
          const u = unitById(s, unitId);
          return u != null && u.damageBonus >= 1;
        },
        { max: MAX_EXCITE_TICKS, poll: 3 },
      );
      const u = unitById(entered.snap, unitId);
      bonusInside = u ? u.damageBonus : 0;

      // Held inside the field, so the excited state is on screen rather than glimpsed.
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "matter outside the field carries no excite bonus",
        bonusOutside,
        0,
      );
      check.expectOk("the atom reached the Catalyst's field", entered.hit);
      check.expectGe(
        "matter in a Catalyst field is excited (+damage per hit)",
        bonusInside,
        1,
      );
    },
  };
}
