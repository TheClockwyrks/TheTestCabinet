// Automated validation for the Placement sub-item `covers-both-lanes`.
//
// On a branching map a tower beside a SHARED stretch reaches matter on both lanes ("Where
// paths overlap, one tower covers both, so those shared stretches are the premium
// coverage", specs/board.md), while a tower beside a single divergent lane reaches only
// that one.
//
// Which end of the fork is shared is the build's own choice — board.md allows a shared
// trunk (the inlet approach) "and/or a shared final run" — so the two stretches the
// scenario needs are DERIVED from the geometry: `sharedStretch` finds the longest run where
// the two lanes are the same world points (and the matching arc length on each), and
// `widestGap` finds where they are furthest apart. Hardcoding them (the shared run at 95% of
// path 0, the divergence at 50%) describes only a fork that rejoins, and fails a conformant
// map that shares its trunk and then diverges to its own collectors.
//
// If the map exposes no shared stretch at all the scenario is not constructible against
// this build, which is inconclusive rather than a failure — `maps.branching-fork` is the
// item that judges whether the fork has one.
//
// THREE runs. Only the first is arranged; the other two are posed inside `act` with
// `poseRun`, since `api.reset` throws there.

import {
  startRun,
  poseRun,
  pathGeom,
  laneGaps,
  sharedStretch,
  widestGap,
  placeCovering,
  spawnAt,
  unitById,
  preconditionUnmet,
  MAP,
} from "../_helpers.mjs";

const SHARED_TOL = 6; // a shared segment is the same world points, not merely a near miss

/** Read the fork's shared and divergent stretches off a branching map's snapshot. */
function forkStretches(snap) {
  const ga = pathGeom(snap.paths[0]);
  const gb = pathGeom(snap.paths[1]);
  const rows = laneGaps(ga, gb);
  const shared = sharedStretch(rows, { tol: SHARED_TOL });
  if (!shared) {
    throw preconditionUnmet(
      "the branching map exposes no stretch its two lanes share",
    );
  }
  return { ga, gb, shared, apart: widestGap(rows) };
}

/**
 * Pose a tower beside path 0 at arc length `towerS` and a unit on `unitPathId` at `unitS`.
 * `begin` opens the run; `pick` chooses the two arc lengths from the derived stretches.
 */
async function poseLaneTest(api, begin, unitPathId, pick) {
  const snap = await begin(api, MAP.branching);
  const f = forkStretches(snap);
  const { towerS, unitS } = pick(f);
  await placeCovering(api, "emitter", f.ga, towerS);
  const id = await spawnAt(api, {
    type: "atom",
    electrons: 6,
    pathId: unitPathId,
    s: unitS,
  });
  return { id, hp0: unitById(await api.snapshot(), id).hp };
}

/** Run the posed scenario and report whether the tower actually got the unit. */
async function actFiresOn(api, { id, hp0 }) {
  // 90 ticks = the old 1.5 s cap; poll 6 = the old 0.1 s chunk.
  const r = await api.until(
    (s) => {
      const u = unitById(s, id);
      return u == null || u.hp < hp0;
    },
    { max: 90, poll: 6 },
  );
  const u = unitById(r.snap, id);
  return u != null && u.hp < hp0;
}

// On the shared stretch the two lanes are the same conduit, so the tower goes beside it and
// the unit is posed at that same place on whichever lane is being tested.
const onShared = (pathId) => (f) => ({
  towerS: f.shared.s,
  unitS: pathId === 0 ? f.shared.s : f.shared.sOther,
});
// Where the lanes are furthest apart, a tower beside one cannot reach the other.
const onDivergent = (f) => ({ towerS: f.apart.s, unitS: f.apart.sOther });

export default function item() {
  let posedSharedLane0;
  let sharedLane0;
  let sharedLane1;
  let divergent;

  return {
    id: "placement.covers-both-lanes",

    async arrange(api) {
      posedSharedLane0 = await poseLaneTest(api, startRun, 0, onShared(0));
    },

    // The shared-run tower reaching each lane in turn, then a divergent-lane tower plainly
    // failing to reach the other lane.
    async act(api) {
      sharedLane0 = await actFiresOn(api, posedSharedLane0);

      sharedLane1 = await actFiresOn(
        api,
        await poseLaneTest(api, poseRun, 1, onShared(1)),
      );
      divergent = await actFiresOn(
        api,
        await poseLaneTest(api, poseRun, 1, onDivergent),
      );
    },

    async assert(api, check) {
      check.expectOk("a shared-stretch tower reaches lane 0", sharedLane0);
      check.expectOk("a shared-stretch tower reaches lane 1", sharedLane1);
      check.expectOk(
        "a divergent-lane tower does NOT reach the other lane",
        divergent === false,
      );
    },
  };
}
