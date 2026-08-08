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
  startScenario,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  focusOnParent,
  poolSpent,
  MAP,
} from "../_helpers.mjs";

const POLYMER_ATOMS = 6; // MATTER.polymer.atoms — specs/matter.md
const MAX_OPEN_TICKS = 1800; // 1800 ticks = the old 30 s cap
// The clip used to cut on the frame the cluster finished opening, which is the frame the
// spray is at its most illegible: fragments are born at their parent's own position
// (specs/board.md), so at that instant the freed atoms are still piled on top of it and each
// other. Freed atoms are faster than the cluster they came from (specs/matter.md), so simply
// running on pulls them apart — a second and a half is enough for the spray to become a
// spray on screen. The sweep keeps counting through it, so a build that sheds its last atom
// a moment later is still counted rather than missed.
const TAIL_TICKS = 90;

export default function item() {
  let id;
  let r;
  // The distinct free atoms seen across `act`, and the subset of them that arrived while the
  // parent still had bond points left. Fresh sets per pass.
  let seen;
  let shedWhileBonded;

  return {
    id: "bonds.sheds-atoms",

    async arrange(api) {
      const snap = await startScenario(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.18;
      await placeCovering(api, "cleaver", g, s0);
      await focusOnParent(api);
      // Spawn upstream so the cluster traverses the tower's full coverage window.
      id = await spawnAt(api, { type: "polymer", pathId: 0, s: s0 - 50 });
      seen = new Set();
      shedWhileBonded = new Set();
    },

    // The cluster being chipped open and shedding its atoms — the whole of the check,
    // and the whole of the clip.
    async act(api) {
      // Every distinct free atom, and separately the ones that arrived while the parent
      // still had bond left. Splitting the two is what lets a failure say WHICH half of the
      // requirement broke — a build that releases its whole spray in one go at the break
      // reports six atoms and no progressive shedding, and a build that drops the final
      // continuation reports five of each. Both used to read "expected 6, got n" and leave
      // the reviewer to work out which had happened.
      const collect = (s) => {
        const parent = unitById(s, id);
        const stillBonded = parent != null && parent.bond > 0;
        for (const u of s.matter) {
          if (u.type !== "atom" || u.id === id) continue;
          seen.add(u.id);
          if (stillBonded) shedWhileBonded.add(u.id);
        }
        // The parent counts once it is itself a free atom — the "continues as the final
        // free atom" half of the rule.
        if (parent != null && parent.type === "atom") seen.add(parent.id);
      };
      // 1800 ticks = the old 30 s cap; poll 3 = the old 0.05 s chunk.
      r = await api.until(
        (s) => {
          collect(s);
          // The pool being SPENT is the event, read off `bond` rather than off the
          // `traits.bonded` flag — see `poolSpent`. Waiting on the flag left this sweep
          // running until the cluster itself died on a build that never clears it.
          const u = unitById(s, id);
          return u == null || poolSpent(u);
        },
        { max: MAX_OPEN_TICKS, poll: 3 },
      );
      // Include the final converted atom (the cluster itself, once fully opened).
      collect(await api.snapshot());
      // Run on so the spray separates on screen, still counting as it goes.
      await api.until(
        (s) => {
          collect(s);
          return false;
        },
        { max: TAIL_TICKS, poll: 3 },
      );
    },

    async assert(api, check) {
      check.expectOk("the cluster opened", r.hit);
      check.expectGe(
        "a cluster sheds a spray of free atoms (more than one)",
        seen.size,
        2,
      );
      // The SHAPE of the release, graded separately from its size, so a failure names which
      // half broke instead of leaving a bare total to be interpreted.
      //
      // Not a fixed count of five, though specs/matter.md's headline sentence — "sheds
      // `k − 1` atoms as its bonds are chipped away and continues as the final free atom" —
      // reads like one. The paragraph goes on to say what happens when a hit crosses several
      // fragment thresholds at once: "what is left to release when the pool finally breaks
      // is only what has not already been shed." A Cleaver deals 4 to a Polymer's pool of 11
      // (2 damage, doubled against bonds), so it empties the pool in three hits and each hit
      // legitimately crosses two thresholds — the reference sheds three on the way down and
      // the rest at the break, and a check demanding five failed it.
      //
      // What the rule does forbid is a cluster that holds together to the last point and
      // then bursts, and that is exactly what this catches: at least one atom off the
      // leading end while the pool still has something in it.
      check.expectGe(
        "atoms come off AS the pool drains, not all at once at the break",
        shedWhileBonded.size,
        1,
      );
      check.expectEq(
        "a 6-atom cluster releases exactly its six atoms",
        seen.size,
        POLYMER_ATOMS,
      );
    },
  };
}
