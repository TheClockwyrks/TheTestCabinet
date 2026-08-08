// Automated validation for the Tower Art sub-item `aim`.
//
// A damage tower's head rotates to face the unit it is firing at. The check builds an
// Emitter beside the lane, poses a unit in range, runs on until the tower acquires it, and
// confirms the tower's reported heading points at the target's world position.

import {
  startScenario,
  pathGeom,
  placeCovering,
  spawnAt,
  towerById,
  unitById,
  preconditionUnmet,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  TICK,
  MAP,
} from "../_helpers.mjs";

// The unit is posed OUTSIDE the tower's range and walks in, so the clip contains the head
// at rest and then the head swinging onto it. Posed in range from the first frame, the
// acquisition had already happened before the recording began and what a reviewer saw was
// a tower that was simply pointing somewhere.
const APPROACH_PX = 80;
const MAX_ACQUIRE_TICKS = 420;
// How long the head is given to FINISH turning after it acquires.
//
// specs/towers.md says "a damage tower's head rotates to face the unit it is firing at",
// and a rotation takes time — a build that eases its head round over a few frames is doing
// exactly what is asked. Reading the heading on the acquisition tick itself demands a head
// that snaps instantly, which is one conformant implementation of several, so the check
// waits for the turn to settle instead and only then measures it.
const MAX_TURN_TICKS = 60;
const AIM_TOLERANCE_RAD = 0.2;

/** Angular difference between the tower's heading and the bearing to its target. */
function aimError(snap, towerId, unitId) {
  const tw = towerById(snap, towerId);
  const u = unitById(snap, unitId);
  if (!tw || !u || tw.angle == null) return Math.PI;
  const expected = Math.atan2(u.y - tw.y, u.x - tw.x);
  let d = Math.abs(tw.angle - expected);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

export default function item() {
  let t;
  let id;
  let r;
  let error;

  return {
    id: "tower-art.aim",

    clipMs: clipBudget(
      LEAD_TICKS + MAX_ACQUIRE_TICKS + MAX_TURN_TICKS + TAIL_TICKS,
    ),

    async arrange(api) {
      const snap = await startScenario(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.2;
      t = await placeCovering(api, "emitter", g, s0);

      const tower = towerById(await api.snapshot(), t.id);
      const startAt = s0 - (tower.range + APPROACH_PX);
      if (startAt < 0) {
        throw preconditionUnmet(
          `the lane has no room upstream of the tower to pose an approach from outside ` +
            `its range (needs ${Math.round(tower.range + APPROACH_PX)}px before ` +
            `s=${Math.round(s0)})`,
        );
      }
      id = await spawnAt(api, {
        type: "atom",
        electrons: 6,
        pathId: 0,
        s: startAt,
      });
    },

    // The head swinging onto the target — which is precisely what the clip is for.
    async act(api) {
      // The head at rest, holding its last heading, with the atom still out of reach.
      await api.advance(LEAD_TICKS);

      r = await api.until((s) => towerById(s, t.id).targetId === id, {
        max: MAX_ACQUIRE_TICKS,
        poll: TICK,
      });
      // ...and the turn allowed to complete before it is measured. See MAX_TURN_TICKS.
      const settled = await api.until(
        (s) => aimError(s, t.id, id) < AIM_TOLERANCE_RAD,
        { max: MAX_TURN_TICKS, poll: TICK },
      );
      error = settled.hit
        ? aimError(settled.snap, t.id, id)
        : aimError(await api.snapshot(), t.id, id);

      // Held while the tower tracks and fires on it.
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the tower acquires the target", r.hit);
      // The heading is measured from the tower's OWN reported position to the target's.
      // Both are contract values (specs/instrumentation.md: a tower's `x`/`y` and `angle`,
      // a unit's `x`/`y`), and where a build puts the head's pivot inside its sprite is its
      // own business, so nudging the expected origin by a fixed few pixels only matches the
      // one build it was measured from. The tolerance is what absorbs a pivot that does not
      // sit dead centre.
      check.expectLt(
        "the tower's head points at its target (radians)",
        error,
        AIM_TOLERANCE_RAD,
      );
    },
  };
}
