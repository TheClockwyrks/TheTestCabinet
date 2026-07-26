// Automated validation for the Targeting sub-item `modes`.
//
// Setting a tower's targeting priority changes which valid in-range unit it fires at.
// The check poses three real atoms whose progress, distance-from-tower, and hit points
// are each arranged so every priority resolves to a distinct, well-defined unit:
//   A — least progress, farthest from the tower, most hit points
//   B — middle progress, nearest the tower, fewest hit points
//   C — most progress
// Each priority is checked from a fresh scene (a single real tick, before any shot
// lands) so the acquired target reflects the priority alone.
//
// FIVE scenes, so FIVE runs. Only the first is arranged; the rest are posed inside `act`
// with `poseRun`, since `api.reset` throws there.

import {
  startRun,
  poseRun,
  pathGeom,
  placeCovering,
  spawnAt,
  TICK,
  MAP,
} from "../_helpers.mjs";

/** Pose the three-atom scene and set `mode`; `begin` opens the run. */
async function poseScene(api, begin, mode) {
  const snap = await begin(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.22;
  const t = await placeCovering(api, "beam", g, s0);
  const A = await spawnAt(api, {
    type: "atom",
    electrons: 6,
    pathId: 0,
    s: s0 - 150,
  });
  const B = await spawnAt(api, {
    type: "atom",
    electrons: 1,
    pathId: 0,
    s: s0,
  });
  const C = await spawnAt(api, {
    type: "atom",
    electrons: 3,
    pathId: 0,
    s: s0 + 110,
  });
  if (mode !== "first") await api.call("setTargeting", t.id, mode);
  return { t, A, B, C };
}

/** One real tick, then read which unit the tower acquired. */
async function actPick(api, { t, A, B, C }) {
  await api.advance(TICK);
  const tower = (await api.snapshot()).towers.find((x) => x.id === t.id);
  return { targetId: tower.targetId, A, B, C };
}

export default function item() {
  let posedLast;
  let last;
  let nearest;
  let farthest;
  let strongest;
  let weakest;

  return {
    id: "targeting.modes",

    async arrange(api) {
      posedLast = await poseScene(api, startRun, "last");
    },

    // Each priority's scene in turn — the same three atoms, a different one singled out
    // each time, which is the whole point of the item.
    async act(api) {
      last = await actPick(api, posedLast);
      nearest = await actPick(api, await poseScene(api, poseRun, "nearest"));
      farthest = await actPick(api, await poseScene(api, poseRun, "farthest"));
      strongest = await actPick(
        api,
        await poseScene(api, poseRun, "strongest"),
      );
      weakest = await actPick(api, await poseScene(api, poseRun, "weakest"));
    },

    async assert(api, check) {
      check.expectEq(
        "LAST targets the least-advanced unit",
        last.targetId,
        last.A,
      );
      check.expectEq(
        "NEAREST targets the unit closest to the tower",
        nearest.targetId,
        nearest.B,
      );
      check.expectEq(
        "FARTHEST targets the unit most distant from the tower",
        farthest.targetId,
        farthest.A,
      );
      check.expectEq(
        "STRONGEST targets the highest-hp unit",
        strongest.targetId,
        strongest.A,
      );
      check.expectEq(
        "WEAKEST targets the lowest-hp unit",
        weakest.targetId,
        weakest.B,
      );
    },
  };
}
