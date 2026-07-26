// Automated validation for the Detection sub-item `other-sources`.
//
// Detection is not one tower. The check confirms two further sources beyond the Catalyst
// each let inert matter be seen and hit: an Ionizer upgraded to its ARRAY branch (which
// grants detection), and a Beam (which sees inert natively at tier I). Each is posed
// against an undetected Noble and must damage it — proving it can see and hit inert
// matter on its own.
//
// TWO runs: the Array scenario is arranged, the Beam scenario is posed inside `act` with
// `poseRun` (no `reset`, which would freeze the recording).

import {
  startRun,
  poseRun,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  MAP,
} from "../_helpers.mjs";

/** Pose an Ionizer upgraded to its ARRAY branch over an undetected Noble. */
async function poseArray(api, begin) {
  const snap = await begin(api, MAP.single, { energy: 100000 });
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.18;
  const t = await placeCovering(api, "ionizer", g, s0);
  await api.call("upgradeTower", t.id); // -> tier II
  await api.call("upgradeTower", t.id, "A"); // -> tier III ARRAY (detection)
  const id = await spawnAt(api, { type: "noble", pathId: 0, s: s0 });
  return { id, hp0: unitById(await api.snapshot(), id).hp };
}

/** Pose a plain tier-I Beam over an undetected Noble. */
async function poseBeam(api, begin) {
  const snap = await begin(api, MAP.single, { energy: 100000 });
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.18;
  await placeCovering(api, "beam", g, s0);
  const id = await spawnAt(api, { type: "noble", pathId: 0, s: s0 });
  return { id, hp0: unitById(await api.snapshot(), id).hp };
}

/** Run until the posed tower damages (or neutralizes) the noble. */
async function seesInert(api, { id, hp0 }) {
  // 180 ticks = the old 3 s cap; poll 3 = the old 0.05 s chunk.
  const r = await api.until(
    (s) => {
      const u = unitById(s, id);
      return u == null || u.hp < hp0;
    },
    { max: 180, poll: 3 },
  );
  return r.hit;
}

export default function item() {
  let posedArray;
  let arrayHit;
  let beamHit;

  return {
    id: "detection.other-sources",

    async arrange(api) {
      posedArray = await poseArray(api, startRun);
    },

    // Both detectors doing the thing they are here for, back to back.
    async act(api) {
      arrayHit = await seesInert(api, posedArray);

      const posedBeam = await poseBeam(api, poseRun);
      beamHit = await seesInert(api, posedBeam);
    },

    async assert(api, check) {
      check.expectOk(
        "an Ionizer's Array branch sees and hits inert matter",
        arrayHit,
      );
      check.expectOk("a Beam sees and hits inert matter natively", beamHit);
    },
  };
}
