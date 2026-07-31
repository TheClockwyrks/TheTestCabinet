// Automated validation for the Maps sub-item `single-path`.
//
// The easy map is ONE continuous path. A real unit posed at the inlet advances along
// it (its progress grows as the real movement system runs), and a unit posed near the
// collector reaches the end and leaks — the real containment cost resolving, not a
// fabricated end. Nothing here announces the outcome; `act` runs the real sim and
// `snapshot` reads it back.

import {
  startScenario,
  pathGeom,
  spawnAt,
  unitById,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let g;
  let pathCount;
  let flowId;
  let p0;
  let p1;
  let intBefore;
  let r;

  return {
    id: "maps.single-path",

    async arrange(api) {
      const snap = await startScenario(api, MAP.single, { integrity: 100000 });
      pathCount = snap.paths.length;
      g = pathGeom(snap.paths[0]);

      // A unit at the inlet, whose advance toward the collector is what `act` measures.
      flowId = await spawnAt(api, {
        type: "atom",
        electrons: 2,
        pathId: 0,
        s: 5,
      });
      p0 = unitById(await api.snapshot(), flowId).progress;
    },

    // Matter flowing the single path: first the inlet unit covering ground, then a second
    // unit reaching the collector and leaking. Spawning is a control op, so posing the
    // second unit mid-`act` is legal.
    async act(api) {
      // 90 ticks = the old 1.5 s.
      await api.advance(90);
      p1 = unitById(await api.snapshot(), flowId).progress;

      // A unit that reaches the collector leaks: it is removed and integrity drops.
      intBefore = (await api.snapshot()).integrity;
      await spawnAt(api, {
        type: "atom",
        electrons: 2,
        pathId: 0,
        s: g.length - 20,
      });
      // 240 ticks = the old 4 s cap; poll 6 = the old 0.1 s chunk.
      r = await api.until((s) => s.integrity < intBefore, {
        max: 240,
        poll: 6,
      });
    },

    async assert(api, check) {
      check.expectEq("the easy map has a single path", pathCount, 1);
      check.expectGt(
        "the unit advances toward the collector (progress)",
        p1,
        p0 + 20,
      );
      check.expectOk("a unit reaching the collector leaks", r.hit);
      check.expectLt("the leak costs integrity", r.snap.integrity, intBefore);
    },
  };
}
