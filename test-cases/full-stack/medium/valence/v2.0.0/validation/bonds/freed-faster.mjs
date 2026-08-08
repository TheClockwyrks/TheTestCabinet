// Automated validation for the Bonds sub-item `freed-faster`.
//
// An atom freed from a cluster moves faster than the cluster it came from — a lighter
// fragment picks up speed. The check reads a Polymer's base speed, chips it with a
// Cleaver until a free atom is shed, and confirms the freed atom's base speed exceeds
// the cluster's.
//
// THE SHED HAS TO HAPPEN WHILE THERE IS STILL A CLUSTER. The wait used to be satisfied by
// any free atom on the board — `matter.some(u => u.type === "atom" && u.id !== id)` — which
// a cluster that holds together to the last point of its pool and then bursts into six
// atoms at once satisfies just as well as one that sheds them off its leading end on the
// way down. So the assertion said "the cluster shed a free atom" about a board with no
// cluster left on it, and a build that never sheds progressively passed the item whose
// whole subject is a fragment outrunning its PARENT.
//
// specs/matter.md is explicit that the shed comes first: "As the pool drains past each
// fragment threshold the cluster sheds a free atom off its leading end, a molecule becoming
// a spray of atoms, and when the pool is spent the cluster's last atom travels on free." So
// the wait now requires a free atom AND a parent that still has bond points left, which is
// the only state in which the comparison this item makes is even well posed — there has to
// be a cluster for the freed atom to be faster than. `bonds.sheds-atoms` grades the same
// rule from the other end, by counting how many arrive before the break.

import {
  startScenario,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  clipBudget,
  LEAD_TICKS,
  MAP,
} from "../_helpers.mjs";

const MAX_SHED_TICKS = 360; // 6 s — the sweep's own cap, mirrored into the clip budget
const TAIL_TICKS = 180; // 3 s, long enough for the freed atom to visibly pull ahead

export default function item() {
  let id;
  let clusterSpeed;
  let r;

  return {
    id: "bonds.freed-faster",

    clipMs: clipBudget(LEAD_TICKS + MAX_SHED_TICKS + TAIL_TICKS),

    async arrange(api) {
      const snap = await startScenario(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.18;
      await placeCovering(api, "cleaver", g, s0);
      // Spawn upstream so the cluster traverses the tower's full coverage window.
      id = await spawnAt(api, { type: "polymer", pathId: 0, s: s0 - 50 });
      clusterSpeed = unitById(await api.snapshot(), id).baseSpeed;
    },

    // Run the real sim until the cluster sheds its first free atom — exactly what the
    // clip needs to show.
    async act(api) {
      // The cluster under fire with its pool still full, before anything has come off it.
      await api.advance(LEAD_TICKS);
      // 360 ticks = the old 6 s cap; poll 3 = the old 0.05 s chunk.
      r = await api.until(
        (s) => {
          const parent = unitById(s, id);
          // A free atom on the board WHILE the parent is still a bonded cluster with pool
          // left. Both halves are required: see the header.
          return (
            parent != null &&
            parent.bond > 0 &&
            s.matter.some((u) => u.type === "atom" && u.id !== id)
          );
        },
        { max: MAX_SHED_TICKS, poll: 3 },
      );
      // ...then run on, which is the only way the item's claim is VISIBLE. A fragment is
      // born at its parent's own position (specs/board.md), so on the frame it appears the
      // two are superimposed and no clip of that instant can show one outrunning the other.
      // The gap the extra speed opens is the evidence; the verdict is read from `baseSpeed`
      // either way, so nothing here decides it.
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk(
        "the cluster shed a free atom while it was still a bonded cluster",
        r.hit,
      );
      // A build that never sheds one is the failure this item is looking for, so the read is
      // guarded: dereferencing a missing atom threw out of the item, and the runtime reports
      // a throw as a broken debug API rather than as the failed requirement it is.
      const freed =
        r.snap.matter.find((u) => u.type === "atom" && u.id !== id) ?? null;
      check.expectGt(
        "a freed atom moves faster than its parent cluster (baseSpeed)",
        freed ? freed.baseSpeed : 0,
        clusterSpeed,
      );
    },
  };
}
