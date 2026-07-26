// Automated validation for the Bonds sub-item `lattice-floods`.
//
// The Lattice is the heaviest matter short of the boss and is built the opposite way
// round to its size: a THIN pool of 8 over SIXTEEN atoms of 6. That is the whole point of
// the type — it opens almost at once and then floods the strippers behind it with a spray
// no single tower clears, rather than presenting a thick buffer to grind. So the check is
// about the shape of the unit, not just that it breaks:
//
//   * its pool is 8, well under a Polymer's 11, despite carrying nearly three times the
//     matter behind it;
//   * opening it releases exactly 16 free atoms, each a full 6-electron atom;
//   * which makes its total shells 104 — the 8 of the pool plus 96 across the spray —
//     and, because energy is paid per shell stripped, exactly what it pays out.
//
// The Cleaver is pointed at the LAST unit in range so it stays on the pool rather than
// drifting onto the atoms it sheds; the spray is then counted from the real matter list.

import {
  startRun,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  focusOnParent,
  TICK,
  MAP,
} from "../_helpers.mjs";

const LATTICE_ATOMS = 16; // MATTER.lattice.atoms — specs/matter.md
const LATTICE_POOL = 8; // MATTER.lattice.bondHP
const ATOM_ELECTRONS = 6; // each constituent atom is a full 6-electron atom
const LATTICE_TOTAL_SHELLS = LATTICE_POOL + LATTICE_ATOMS * ATOM_ELECTRONS; // 104
const POLYMER_POOL = 11; // MATTER.polymer.bondHP — the thinner-pool comparison
const MAX_OPEN_TICKS = 1800; // 1800 ticks = the old 30 s cap

export default function item() {
  let id;
  let born;
  let r;
  // Every distinct free atom the cluster ever releases, and what each was born with.
  // Accumulated across `act`, so it lives in the factory closure and each pass counts
  // its own spray from scratch.
  let seen;

  return {
    id: "bonds.lattice-floods",

    async arrange(api) {
      const snap = await startRun(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.2;
      await placeCovering(api, "cleaver", g, s0);
      await focusOnParent(api);
      id = await spawnAt(api, { type: "lattice", pathId: 0, s: s0 - 50 });

      born = unitById(await api.snapshot(), id);
      seen = new Map();
    },

    // The cluster opening and flooding the lane — the behavior the item is about, and
    // the only thing worth filming.
    async act(api) {
      // Poll every TICK: an atom can be shed and neutralized between coarser reads, and
      // this check counts the spray exhaustively.
      r = await api.until(
        (s) => {
          for (const u of s.matter)
            if (u.type === "atom" && !seen.has(u.id))
              seen.set(u.id, u.electrons);
          const u = unitById(s, id);
          return u == null || u.traits.bonded === false;
        },
        { max: MAX_OPEN_TICKS, poll: TICK },
      );
      // Include the final converted atom (the cluster itself, once fully opened).
      for (const u of (await api.snapshot()).matter)
        if (u.type === "atom" && !seen.has(u.id)) seen.set(u.id, u.electrons);
    },

    async assert(api, check) {
      check.expectEq("a Lattice is a bonded cluster", born.traits.bonded, true);
      check.expectEq("its bond pool is a thin 8", born.maxBond, LATTICE_POOL);
      check.expectLt(
        "that pool is thinner than a Polymer's, for far more matter behind it",
        born.maxBond,
        POLYMER_POOL,
      );

      check.expectOk("the pool was broken through", r.hit);
      check.expectEq(
        "opening a Lattice releases all sixteen of its atoms",
        seen.size,
        LATTICE_ATOMS,
      );
      const shells = [...seen.values()].reduce((a, b) => a + b, 0);
      check.expectEq(
        "every atom in the spray is a full 6-electron atom",
        shells,
        LATTICE_ATOMS * ATOM_ELECTRONS,
      );
      check.expectEq(
        "so a Lattice is 104 total shells — its pool plus its spray",
        born.maxBond + shells,
        LATTICE_TOTAL_SHELLS,
      );
    },
  };
}
