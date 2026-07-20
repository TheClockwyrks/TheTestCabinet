// Automated validation for the Bonds sub-item `sheds-atoms`.
//
// As its bond pool depletes a cluster sheds its constituent atoms as a spray of free
// atoms, rather than vanishing whole. A `k`-atom cluster sheds `k − 1` atoms as the pool
// drains and continues as the final free atom, so it releases exactly `k` in all. The
// check chips a Polymer (6 atoms) open with a Cleaver, counting every distinct free atom
// it ever releases — tracked across polls, so an atom neutralized before the next read is
// still counted — and confirms all six arrive.
//
// The Cleaver is pointed at the LAST unit in range: freed atoms are shed just AHEAD of
// their parent, so a tower on the default FIRST priority would abandon the cluster for
// them and the pool would never finish draining.

import {
  startRun,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  focusOnParent,
  MAP,
} from "../_helpers.mjs";

const POLYMER_ATOMS = 6; // MATTER.polymer.atoms — specs/matter.md
const MAX_OPEN_TICKS = 1800; // 1800 ticks = the old 30 s cap

export default function item() {
  let id;
  let r;
  // The distinct free atoms seen across `act`; a fresh set per pass.
  let seen;

  return {
    id: "bonds.sheds-atoms",

    async arrange(api) {
      const snap = await startRun(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.18;
      await placeCovering(api, "cleaver", g, s0);
      await focusOnParent(api);
      // Spawn upstream so the cluster traverses the tower's full coverage window.
      id = await spawnAt(api, { type: "polymer", pathId: 0, s: s0 - 50 });
      seen = new Set();
    },

    // The cluster being chipped open and shedding its atoms — the whole of the check,
    // and the whole of the clip.
    async act(api) {
      // 1800 ticks = the old 30 s cap; poll 3 = the old 0.05 s chunk.
      r = await api.until(
        (s) => {
          for (const u of s.matter) if (u.type === "atom") seen.add(u.id);
          const u = unitById(s, id);
          return u == null || u.traits.bonded === false;
        },
        { max: MAX_OPEN_TICKS, poll: 3 },
      );
      // Include the final converted atom (the cluster itself, once fully opened).
      for (const u of (await api.snapshot()).matter)
        if (u.type === "atom") seen.add(u.id);
    },

    async assert(api, check) {
      check.expectOk("the cluster opened", r.hit);
      check.expectGe(
        "a cluster sheds a spray of free atoms (more than one)",
        seen.size,
        2,
      );
      check.expectEq(
        "a 6-atom cluster releases exactly its six atoms",
        seen.size,
        POLYMER_ATOMS,
      );
    },
  };
}
