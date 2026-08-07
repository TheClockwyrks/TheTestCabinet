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
  startScenario,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  focusOnParent,
  poolSpent,
  clipBudget,
  TICK,
  MAP,
} from "../_helpers.mjs";

const LATTICE_ATOMS = 16; // MATTER.lattice.atoms — specs/matter.md
const LATTICE_POOL = 8; // MATTER.lattice.bondHP
const ATOM_ELECTRONS = 6; // each constituent atom is a full 6-electron atom
const LATTICE_TOTAL_SHELLS = LATTICE_POOL + LATTICE_ATOMS * ATOM_ELECTRONS; // 104
const POLYMER_POOL = 11; // MATTER.polymer.bondHP — the thinner-pool comparison
const MAX_OPEN_TICKS = 1800; // 1800 ticks = the old 30 s cap
// The lead-in: the Lattice on screen with its pool intact, before anything comes off it, so
// the flood that follows has something to be a change FROM.
const LEAD_IN_TICKS = 120;
// Sixteen atoms are born at their parent's own position (specs/board.md), so on the frame the
// pool gives way they are one illegible pile — which is precisely where the clip used to cut.
// Freed atoms are faster than the cluster they came from (specs/matter.md), so running on is
// what turns the pile into the flood the item is named for. The sweep keeps counting through
// the tail, so a build that releases the tail of its spray a moment later is still counted.
// Two seconds of that was not enough to tell sixteen atoms apart from a pile — the review
// could not count them on screen at all. The COUNTS this item asserts never depended on the
// picture (see the note above `assert`), but the clip is what the rest of the item is graded
// on, so the tail is five seconds.
const TAIL_TICKS = 300;

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

    clipMs: clipBudget(LEAD_IN_TICKS + 360 + TAIL_TICKS),

    async arrange(api) {
      const snap = await startScenario(api, MAP.single);
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
      // What each atom was BORN with, keyed on `maxHp` — "remaining and starting shells"
      // (specs/instrumentation.md) — and never on the live `electrons` count.
      //
      // This is the same distinction `decayKind` in `_helpers.mjs` exists to make, and this
      // item had the bug it warns about. `electrons` FALLS as an atom is stripped, so
      // recording it at first sighting records 6 only if the sweep happens to see the atom
      // before anything hits it. A Lattice's pool is a thin 8 (two Cleaver hits), so the
      // flood arrives almost immediately and the strippers are straight onto it — and the
      // moment two of the sixteen were first seen at 5 rather than 6, a conformant reference
      // build reported "94 of 96 shells" and failed its own item. `maxHp` does not move, so
      // it reads the same however late the atom is first sighted and whatever the poll rate.
      const collect = (s) => {
        for (const u of s.matter)
          if (u.type === "atom" && !seen.has(u.id)) seen.set(u.id, u.maxHp);
      };
      // The lead-in COLLECTS as it films. An `advance` here would be two seconds of the
      // sweep not running, which on a unit that opens this fast is two seconds in which the
      // whole spray can be born and start taking hits unobserved.
      await api.until(
        (s) => {
          collect(s);
          return false;
        },
        { max: LEAD_IN_TICKS, poll: TICK },
      );
      // Poll every TICK: an atom can be shed and neutralized between coarser reads, and
      // this check counts the spray exhaustively.
      r = await api.until(
        (s) => {
          collect(s);
          // The pool being SPENT is the event — read off `bond`, not the `traits.bonded`
          // flag (see `poolSpent`).
          const u = unitById(s, id);
          return u == null || poolSpent(u);
        },
        { max: MAX_OPEN_TICKS, poll: TICK },
      );
      // Include the final converted atom (the cluster itself, once fully opened).
      collect(await api.snapshot());
      // Run on so the flood spreads out on screen, still counting as it goes.
      await api.until(
        (s) => {
          collect(s);
          return false;
        },
        { max: TAIL_TICKS, poll: TICK },
      );
    },

    // Every number below is read out of the snapshot — the pool the unit was born with, the
    // ids of the atoms it released, and the electrons each of those carried. None of it is
    // measured off the picture, so the counts hold whether or not the spray is legible on
    // screen; the longer tail above is for the reviewer, not for the verdict.
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
        "every atom in the spray was born a full 6-electron atom",
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
