// Automated validation for the Placement sub-item `covers-both-lanes`.
//
// On a branching map a tower beside the shared/branch run reaches matter on BOTH lanes,
// while a tower beside a single divergent lane reaches only that one. The check builds a
// tower beside path 0's shared final run and confirms it fires on a real unit posed on
// each lane there; then builds a tower beside path 0's divergent stretch and confirms it
// does NOT reach a unit on the other lane's divergent stretch.
//
// THREE runs. Only the first is arranged; the other two are posed inside `act` with
// `poseRun`, since `api.reset` throws there. The old script opened a FOURTH run purely to
// film one tower covering both lanes — that is what the first two scenarios already
// demonstrate, so the extra run is gone.

import {
  startRun,
  poseRun,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  MAP,
} from "../_helpers.mjs";

/** Pose a tower beside path 0 at `towerFrac` and a unit on `unitPathId` at `unitFrac`. */
async function poseLaneTest(api, begin, towerFrac, unitPathId, unitFrac) {
  const snap = await begin(api, MAP.branching);
  const g0 = pathGeom(snap.paths[0]);
  await placeCovering(api, "emitter", g0, g0.length * towerFrac);
  const gU = pathGeom(snap.paths[unitPathId]);
  const id = await spawnAt(api, {
    type: "atom",
    electrons: 6,
    pathId: unitPathId,
    s: gU.length * unitFrac,
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

export default function item() {
  let posedSharedLane0;
  let sharedLane0;
  let sharedLane1;
  let divergent;

  return {
    id: "placement.covers-both-lanes",

    async arrange(api) {
      posedSharedLane0 = await poseLaneTest(api, startRun, 0.95, 0, 0.92);
    },

    // The shared-run tower reaching each lane in turn, then a divergent-lane tower plainly
    // failing to reach the other lane.
    async act(api) {
      sharedLane0 = await actFiresOn(api, posedSharedLane0);

      sharedLane1 = await actFiresOn(
        api,
        await poseLaneTest(api, poseRun, 0.95, 1, 0.92),
      );
      divergent = await actFiresOn(
        api,
        await poseLaneTest(api, poseRun, 0.5, 1, 0.5),
      );
    },

    async assert(api, check) {
      check.expectOk("a shared-run tower reaches lane 0", sharedLane0);
      check.expectOk("a shared-run tower reaches lane 1", sharedLane1);
      check.expectOk(
        "a divergent-lane tower does NOT reach the other lane",
        divergent === false,
      );
    },
  };
}
