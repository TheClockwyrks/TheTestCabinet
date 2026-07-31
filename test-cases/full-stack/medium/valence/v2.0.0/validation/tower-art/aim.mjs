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
  TICK,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let t;
  let id;
  let r;

  return {
    id: "tower-art.aim",

    async arrange(api) {
      const snap = await startScenario(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.2;
      t = await placeCovering(api, "emitter", g, s0);
      id = await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 });
    },

    // The head swinging onto the target — which is precisely what the clip is for.
    async act(api) {
      // 60 ticks = the old 1 s cap. The old poll of 0.02 s is 1.2 ticks, which the
      // contract refuses; it meant "sample as finely as possible", and the heading must be
      // read on the acquisition tick before the head has swung further.
      r = await api.until((s) => towerById(s, t.id).targetId === id, {
        max: 60,
        poll: TICK,
      });
    },

    async assert(api, check) {
      check.expectOk("the tower acquires the target", r.hit);
      const tw = towerById(r.snap, t.id);
      const u = unitById(r.snap, id);
      // The heading is measured from the tower's OWN reported position to the target's.
      // Both are contract values (specs/instrumentation.md: a tower's `x`/`y` and `angle`,
      // a unit's `x`/`y`), and specs/towers.md says only that "a damage tower's head
      // rotates to face the unit it is firing at" — where a build puts the head's pivot
      // inside its sprite is its own business, so nudging the expected origin by a fixed
      // few pixels only matches the one build it was measured from. The 0.2 rad tolerance
      // is what absorbs a pivot that does not sit dead centre.
      const expected = Math.atan2(u.y - tw.y, u.x - tw.x);
      let d = Math.abs(tw.angle - expected);
      if (d > Math.PI) d = 2 * Math.PI - d;
      check.expectLt("the tower's head points at its target (radians)", d, 0.2);
    },
  };
}
